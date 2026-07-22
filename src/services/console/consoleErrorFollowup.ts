import * as vscode from 'vscode';
import type { LanguageRuntimePackage, PackageSpec } from '../../api';

export interface ConsoleError {
    readonly sessionId: string;
    readonly languageId: string;
    readonly name: string;
    readonly message: string;
    readonly traceback: readonly string[];
}

export interface ConsoleErrorSuggestion {
    readonly id: string;
    readonly iconId: string;
    readonly label: string;
    run(): Promise<void>;
}

export interface ConsoleErrorSuggestionProvider {
    provideSuggestions(
        error: ConsoleError,
        token: vscode.CancellationToken,
    ): Promise<readonly ConsoleErrorSuggestion[]>;
}

export interface ConsoleErrorFollowupServiceLike {
    getSuggestions(
        error: ConsoleError,
        token: vscode.CancellationToken,
    ): Promise<readonly ConsoleErrorSuggestion[]>;
}

export class ConsoleErrorFollowupService implements ConsoleErrorFollowupServiceLike, vscode.Disposable {
    private readonly _providers = new Set<ConsoleErrorSuggestionProvider>();

    registerProvider(provider: ConsoleErrorSuggestionProvider): vscode.Disposable {
        this._providers.add(provider);
        return new vscode.Disposable(() => this._providers.delete(provider));
    }

    async getSuggestions(
        error: ConsoleError,
        token: vscode.CancellationToken,
    ): Promise<readonly ConsoleErrorSuggestion[]> {
        const suggestions = await Promise.all(
            [...this._providers].map(async provider => {
                try {
                    return token.isCancellationRequested
                        ? []
                        : await provider.provideSuggestions(error, token);
                } catch {
                    // One provider must never prevent another provider, or the
                    // original runtime error, from reaching the Console.
                    return [];
                }
            }),
        );
        return suggestions.flat();
    }

    dispose(): void {
        this._providers.clear();
    }
}

interface ConsolePackageInstance {
    readonly packages: readonly LanguageRuntimePackage[];
    searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
}

export interface ConsolePackageService {
    getInstance(sessionId: string): ConsolePackageInstance | undefined;
}

const PythonMissingModulePattern = /No module named ['"]([^'"]+)['"]/;
const RMissingPackagePattern = /there is no package called ['"\u2018]([^'"\u2019]+)['"\u2019]/;

export function extractMissingPackageName(error: Pick<ConsoleError, 'languageId' | 'message'>): string | undefined {
    if (error.languageId === 'python') {
        return PythonMissingModulePattern.exec(error.message)?.[1]?.split('.')[0];
    }
    if (error.languageId === 'r') {
        return RMissingPackagePattern.exec(error.message)?.[1];
    }
    return undefined;
}

/**
 * Positron-style missing-package follow-up provider. A repository search is
 * required before an action is offered, so a regex match alone never becomes
 * a misleading install button.
 */
export class MissingPackageErrorProvider implements ConsoleErrorSuggestionProvider {
    constructor(private readonly _packagesService: ConsolePackageService) {}

    async provideSuggestions(
        error: ConsoleError,
        token: vscode.CancellationToken,
    ): Promise<readonly ConsoleErrorSuggestion[]> {
        if (!vscode.workspace.getConfiguration('packages').get<boolean>('suggestInstallOnError', true)) {
            return [];
        }

        const referencedName = extractMissingPackageName(error);
        const instance = this._packagesService.getInstance(error.sessionId);
        if (!referencedName || !instance || token.isCancellationRequested) {
            return [];
        }

        const normalizedName = referencedName.toLocaleLowerCase();
        if (instance.packages.some(pkg => pkg.name.toLocaleLowerCase() === normalizedName)) {
            return [];
        }

        const candidates = await instance.searchPackages(referencedName, token);
        const installablePackage = candidates.find(pkg =>
            pkg.name.toLocaleLowerCase() === normalizedName ||
            pkg.displayName?.toLocaleLowerCase() === normalizedName,
        );
        if (!installablePackage || token.isCancellationRequested) {
            return [];
        }

        return [{
            id: `install-package:${installablePackage.name}`,
            iconId: 'lightbulb',
            label: vscode.l10n.t('Install {0}', installablePackage.name),
            run: () => instance.installPackages([{ name: installablePackage.name }], token),
        }];
    }
}
