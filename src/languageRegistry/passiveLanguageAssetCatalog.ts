import * as path from 'path';
import * as vscode from 'vscode';
import type { ILanguageWebviewAssets } from '../api';

const LANGUAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

interface SupervisorLanguageAssetManifest {
    readonly languageAssetsVersion?: unknown;
    readonly languages?: unknown;
}

interface LanguageAssetDeclaration {
    readonly languageId: string;
    readonly displayName?: string;
    readonly assets?: {
        readonly localResourceRoots?: readonly string[];
        readonly monacoSupportModule?: string;
        readonly textMateGrammar?: {
            readonly scopeName?: string;
            readonly path?: string;
        };
    };
}

export interface PassiveLanguageAssetEntry {
    readonly ownerExtensionId: string;
    readonly languageId: string;
    readonly displayName?: string;
    readonly assets: ILanguageWebviewAssets;
}

export interface PassiveLanguageAssetDiagnostic {
    readonly ownerExtensionId: string;
    readonly languageId?: string;
    readonly severity: 'warning' | 'error';
    readonly message: string;
}

export interface PassiveLanguageAssetSnapshot {
    readonly generation: number;
    readonly entries: readonly PassiveLanguageAssetEntry[];
    readonly diagnostics: readonly PassiveLanguageAssetDiagnostic[];
}

interface ExtensionManifestSource {
    readonly id: string;
    readonly extensionUri: vscode.Uri;
    readonly packageJSON: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelativeAssetPath(value: string): boolean {
    if (!value.trim() || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
        return false;
    }
    return !value.replace(/\\/g, '/').split('/').some(segment => segment === '..');
}

function isUriWithin(root: vscode.Uri, candidate: vscode.Uri): boolean {
    if (root.scheme !== candidate.scheme || root.authority !== candidate.authority) {
        return false;
    }
    const normalizedRoot = path.posix.normalize(root.path).replace(/\/$/, '');
    const normalizedCandidate = path.posix.normalize(candidate.path);
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function uriParent(uri: vscode.Uri): vscode.Uri {
    return uri.with({ path: path.posix.dirname(uri.path) });
}

export class PassiveLanguageAssetCatalog implements vscode.Disposable {
    private readonly _onDidChangeSnapshot = new vscode.EventEmitter<PassiveLanguageAssetSnapshot>();
    private readonly _extensionChangeDisposable: vscode.Disposable | undefined;
    private _snapshot: PassiveLanguageAssetSnapshot = Object.freeze({
        generation: 0,
        entries: Object.freeze([]),
        diagnostics: Object.freeze([]),
    });

    readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

    constructor(
        private readonly _getExtensions: () => readonly ExtensionManifestSource[] = () =>
            vscode.extensions.all,
        onDidChangeExtensions: vscode.Event<void> | undefined = vscode.extensions.onDidChange,
        private readonly _log?: vscode.LogOutputChannel,
    ) {
        this.refresh();
        this._extensionChangeDisposable = onDidChangeExtensions?.(() => this.refresh());
    }

    get snapshot(): PassiveLanguageAssetSnapshot {
        return this._snapshot;
    }

    refresh(): void {
        const diagnostics: PassiveLanguageAssetDiagnostic[] = [];
        const candidates = new Map<string, PassiveLanguageAssetEntry[]>();

        for (const extension of this._getExtensions()) {
            const packageJson = isRecord(extension.packageJSON) ? extension.packageJSON : undefined;
            const manifest = packageJson?.supervisor as SupervisorLanguageAssetManifest | undefined;
            if (!manifest) {
                continue;
            }
            if (manifest.languageAssetsVersion !== 1) {
                diagnostics.push({
                    ownerExtensionId: extension.id,
                    severity: 'warning',
                    message: `Unsupported supervisor.languageAssetsVersion '${String(manifest.languageAssetsVersion)}'.`,
                });
                continue;
            }
            if (!Array.isArray(manifest.languages)) {
                diagnostics.push({
                    ownerExtensionId: extension.id,
                    severity: 'error',
                    message: 'supervisor.languages must be an array.',
                });
                continue;
            }

            for (const value of manifest.languages) {
                const entry = this._parseDeclaration(extension, value, diagnostics);
                if (!entry) {
                    continue;
                }
                const languageCandidates = candidates.get(entry.languageId) ?? [];
                languageCandidates.push(entry);
                candidates.set(entry.languageId, languageCandidates);
            }
        }

        const selected: PassiveLanguageAssetEntry[] = [];
        for (const languageId of Array.from(candidates.keys()).sort()) {
            const manifestCandidates = [...(candidates.get(languageId) ?? [])]
                .sort((left, right) => left.ownerExtensionId.localeCompare(right.ownerExtensionId));
            if (manifestCandidates.length > 0) {
                selected.push(manifestCandidates[0]);
                if (manifestCandidates.length > 1) {
                    diagnostics.push({
                        ownerExtensionId: manifestCandidates[0].ownerExtensionId,
                        languageId,
                        severity: 'warning',
                        message: `Multiple manifest owners declared '${languageId}'; selected ` +
                            `'${manifestCandidates[0].ownerExtensionId}' by stable owner ordering.`,
                    });
                }
            }
        }

        this._publish(this._deduplicateSelectedAssets(selected, diagnostics), diagnostics);
    }

    dispose(): void {
        this._extensionChangeDisposable?.dispose();
        this._onDidChangeSnapshot.dispose();
    }

    private _parseDeclaration(
        extension: ExtensionManifestSource,
        value: unknown,
        diagnostics: PassiveLanguageAssetDiagnostic[],
    ): PassiveLanguageAssetEntry | undefined {
        if (!isRecord(value) || typeof value.languageId !== 'string' ||
            !LANGUAGE_ID_PATTERN.test(value.languageId)) {
            diagnostics.push({
                ownerExtensionId: extension.id,
                severity: 'error',
                message: 'Language asset declaration has an invalid languageId.',
            });
            return undefined;
        }
        const declaration = value as unknown as LanguageAssetDeclaration;
        if (declaration.assets !== undefined && !isRecord(declaration.assets)) {
            diagnostics.push({
                ownerExtensionId: extension.id,
                languageId: declaration.languageId,
                severity: 'error',
                message: 'Language asset declaration assets must be an object.',
            });
            return undefined;
        }

        const resolve = (assetPath: string, label: string): vscode.Uri | undefined => {
            if (!isRelativeAssetPath(assetPath)) {
                diagnostics.push({
                    ownerExtensionId: extension.id,
                    languageId: declaration.languageId,
                    severity: 'error',
                    message: `${label} must be a relative path inside the extension.`,
                });
                return undefined;
            }
            const uri = vscode.Uri.joinPath(extension.extensionUri, assetPath);
            if (!isUriWithin(extension.extensionUri, uri)) {
                diagnostics.push({
                    ownerExtensionId: extension.id,
                    languageId: declaration.languageId,
                    severity: 'error',
                    message: `${label} resolves outside the extension root.`,
                });
                return undefined;
            }
            return uri;
        };

        const assets = declaration.assets;
        const roots: vscode.Uri[] = [];
        if (Array.isArray(assets?.localResourceRoots)) {
            for (const rootPath of assets.localResourceRoots) {
                if (typeof rootPath !== 'string') {
                    continue;
                }
                const root = resolve(rootPath, 'localResourceRoots entry');
                if (root) {
                    roots.push(root);
                }
            }
        }

        const monacoSupportModule = typeof assets?.monacoSupportModule === 'string'
            ? resolve(assets.monacoSupportModule, 'monacoSupportModule')
            : undefined;
        const grammarPath = assets?.textMateGrammar?.path;
        const grammarUri = typeof grammarPath === 'string'
            ? resolve(grammarPath, 'textMateGrammar.path')
            : undefined;

        if (roots.length === 0) {
            for (const root of [monacoSupportModule, grammarUri].filter(
                (uri): uri is vscode.Uri => !!uri,
            ).map(uriParent)) {
                if (!roots.some(existing => existing.toString() === root.toString())) {
                    roots.push(root);
                }
            }
        }
        if (monacoSupportModule && !roots.some(root => isUriWithin(root, monacoSupportModule))) {
            diagnostics.push({
                ownerExtensionId: extension.id,
                languageId: declaration.languageId,
                severity: 'error',
                message: 'monacoSupportModule is not contained by a declared localResourceRoot.',
            });
            return undefined;
        }

        const scopeName = assets?.textMateGrammar?.scopeName;
        const textMateGrammar = grammarUri && typeof scopeName === 'string' && scopeName.trim()
            ? { scopeName, grammarUri }
            : undefined;
        if (grammarUri && !textMateGrammar) {
            diagnostics.push({
                ownerExtensionId: extension.id,
                languageId: declaration.languageId,
                severity: 'warning',
                message: 'TextMate grammar was ignored because scopeName is missing.',
            });
        }

        return Object.freeze({
            ownerExtensionId: extension.id,
            languageId: declaration.languageId,
            displayName: declaration.displayName,
            assets: Object.freeze({
                localResourceRoots: Object.freeze(roots),
                monacoSupportModule,
                textMateGrammar,
            }),
        });
    }

    private _publish(
        entries: readonly PassiveLanguageAssetEntry[],
        diagnostics: readonly PassiveLanguageAssetDiagnostic[],
    ): void {
        this._snapshot = Object.freeze({
            generation: this._snapshot.generation + 1,
            entries: Object.freeze([...entries]),
            diagnostics: Object.freeze([...diagnostics]),
        });
        for (const diagnostic of diagnostics) {
            const message = `[LanguageAssets] owner=${diagnostic.ownerExtensionId} ` +
                `language=${diagnostic.languageId ?? '-'} ${diagnostic.message}`;
            if (diagnostic.severity === 'error') {
                this._log?.error(message);
            } else {
                this._log?.warn(message);
            }
        }
        this._onDidChangeSnapshot.fire(this._snapshot);
    }

    private _deduplicateSelectedAssets(
        entries: readonly PassiveLanguageAssetEntry[],
        diagnostics: PassiveLanguageAssetDiagnostic[],
    ): PassiveLanguageAssetEntry[] {
        const result = entries.map(entry => ({
            ...entry,
            assets: { ...entry.assets },
        }));
        const stableIndices = result.map((_, index) => index).sort((left, right) => {
            const leftKey = `${result[left].ownerExtensionId}:${result[left].languageId}`;
            const rightKey = `${result[right].ownerExtensionId}:${result[right].languageId}`;
            return leftKey.localeCompare(rightKey);
        });
        const moduleOwners = new Map<string, PassiveLanguageAssetEntry>();
        const scopeOwners = new Map<string, PassiveLanguageAssetEntry>();

        for (const index of stableIndices) {
            const entry = result[index];
            const module = entry.assets.monacoSupportModule;
            if (module) {
                const key = module.toString();
                const owner = moduleOwners.get(key);
                if (owner) {
                    diagnostics.push({
                        ownerExtensionId: entry.ownerExtensionId,
                        languageId: entry.languageId,
                        severity: 'warning',
                        message: `Monaco module conflicts with '${owner.ownerExtensionId}/${owner.languageId}' ` +
                            'and was ignored.',
                    });
                    entry.assets = { ...entry.assets, monacoSupportModule: undefined };
                } else {
                    moduleOwners.set(key, entry);
                }
            }

            const grammar = entry.assets.textMateGrammar;
            if (grammar) {
                const owner = scopeOwners.get(grammar.scopeName);
                if (owner) {
                    diagnostics.push({
                        ownerExtensionId: entry.ownerExtensionId,
                        languageId: entry.languageId,
                        severity: 'warning',
                        message: `TextMate scope '${grammar.scopeName}' conflicts with ` +
                            `'${owner.ownerExtensionId}/${owner.languageId}' and was ignored.`,
                    });
                    entry.assets = { ...entry.assets, textMateGrammar: undefined };
                } else {
                    scopeOwners.set(grammar.scopeName, entry);
                }
            }
        }

        return result.map(entry => Object.freeze({
            ...entry,
            assets: Object.freeze(entry.assets),
        }));
    }

}
