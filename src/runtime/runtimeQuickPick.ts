import * as vscode from 'vscode';

export interface RuntimeQuickPickCandidate {
    languageId: string;
    languageName: string;
    languageVersion?: string;
    runtimeName: string;
    runtimePath: string;
    runtimeSource: string;
    iconPath?: vscode.IconPath;
    installation: unknown;
    preferred: boolean;
    active: boolean;
}

export interface RuntimeQuickPickItem extends vscode.QuickPickItem {
    languageId?: string;
    runtimePath?: string;
    installation?: unknown;
}

interface RuntimeQuickPickGroup {
    languageName: string;
    primary: RuntimeQuickPickCandidate;
    alternates: RuntimeQuickPickCandidate[];
}

function compareVersionsDescending(left: string | undefined, right: string | undefined): number {
    if (!left || !right) {
        return 0;
    }

    const leftParts = left.split('.').map(part => Number.parseInt(part, 10));
    const rightParts = right.split('.').map(part => Number.parseInt(part, 10));
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index++) {
        const difference = (rightParts[index] || 0) - (leftParts[index] || 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

function toQuickPickItem(candidate: RuntimeQuickPickCandidate): RuntimeQuickPickItem {
    return {
        label: candidate.runtimeName,
        detail: candidate.runtimePath,
        iconPath: candidate.iconPath,
        picked: candidate.active,
        languageId: candidate.languageId,
        runtimePath: candidate.runtimePath,
        installation: candidate.installation,
    };
}

/**
 * Builds the cross-language interpreter list using Positron's grouping model:
 * one preferred runtime per language under Suggested, followed by alternate
 * runtimes grouped by their source.
 */
export function buildRuntimeQuickPickItems(
    candidates: readonly RuntimeQuickPickCandidate[],
): RuntimeQuickPickItem[] {
    const candidatesByLanguage = new Map<string, RuntimeQuickPickCandidate[]>();
    for (const candidate of candidates) {
        const languageCandidates = candidatesByLanguage.get(candidate.languageId) ?? [];
        languageCandidates.push(candidate);
        candidatesByLanguage.set(candidate.languageId, languageCandidates);
    }

    const groups: RuntimeQuickPickGroup[] = [];
    for (const languageCandidates of candidatesByLanguage.values()) {
        const primary = languageCandidates.find(candidate => candidate.preferred) ?? languageCandidates[0];
        groups.push({
            languageName: primary.languageName,
            primary,
            alternates: languageCandidates.filter(candidate => candidate !== primary),
        });
    }
    groups.sort((left, right) => left.languageName.localeCompare(right.languageName));

    const items: RuntimeQuickPickItem[] = [];
    if (groups.length > 0) {
        items.push({
            kind: vscode.QuickPickItemKind.Separator,
            label: 'Suggested',
        });
        items.push(...groups.map(group => toQuickPickItem(group.primary)));
    }

    for (const group of groups) {
        const candidatesBySource = new Map<string, RuntimeQuickPickCandidate[]>();
        for (const candidate of group.alternates) {
            const sourceCandidates = candidatesBySource.get(candidate.runtimeSource) ?? [];
            sourceCandidates.push(candidate);
            candidatesBySource.set(candidate.runtimeSource, sourceCandidates);
        }

        for (const [source, sourceCandidates] of candidatesBySource) {
            items.push({
                kind: vscode.QuickPickItemKind.Separator,
                label: source,
            });
            sourceCandidates
                .sort((left, right) =>
                    compareVersionsDescending(left.languageVersion, right.languageVersion) ||
                    left.runtimeName.localeCompare(right.runtimeName)
                )
                .forEach(candidate => items.push(toQuickPickItem(candidate)));
        }
    }

    return items;
}
