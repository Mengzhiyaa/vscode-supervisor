import * as vscode from 'vscode';
import type { ConsoleThemeData, ConsoleThemeRule } from '../shared/console';

type RawTokenColor = {
    scope?: string | string[];
    settings?: {
        foreground?: string;
        background?: string;
        fontStyle?: string;
    };
};

const THEME_FILE_BY_KIND: Record<vscode.ColorThemeKind, string> = {
    [vscode.ColorThemeKind.Light]: 'light_plus.json',
    [vscode.ColorThemeKind.Dark]: 'dark_plus.json',
    [vscode.ColorThemeKind.HighContrast]: 'hc_black.json',
    [vscode.ColorThemeKind.HighContrastLight]: 'hc_light.json',
};

const BASE_BY_KIND: Record<vscode.ColorThemeKind, ConsoleThemeData['base']> = {
    [vscode.ColorThemeKind.Light]: 'vs',
    [vscode.ColorThemeKind.Dark]: 'vs-dark',
    [vscode.ColorThemeKind.HighContrast]: 'hc-black',
    [vscode.ColorThemeKind.HighContrastLight]: 'hc-light',
};

type ThemeDocument = {
    include?: string;
    tokenColors?: RawTokenColor[];
};

/**
 * Embedded default token colors extracted from VS Code's dark_plus.json.
 * Used as fallback when theme files cannot be read (e.g., remote servers
 * where VS Code Server doesn't include the theme-defaults extension).
 */
const DARK_DEFAULT_TOKEN_COLORS: RawTokenColor[] = [
    { scope: 'meta.embedded', settings: { foreground: '#D4D4D4' } },
    { scope: 'comment', settings: { foreground: '#6A9955' } },
    { scope: 'string', settings: { foreground: '#CE9178' } },
    { scope: 'keyword', settings: { foreground: '#569CD6' } },
    { scope: 'keyword.operator', settings: { foreground: '#D4D4D4' } },
    { scope: 'keyword.operator.expression', settings: { foreground: '#569CD6' } },
    { scope: 'constant.numeric', settings: { foreground: '#B5CEA8' } },
    { scope: 'constant.language', settings: { foreground: '#569CD6' } },
    { scope: 'constant.character', settings: { foreground: '#569CD6' } },
    { scope: 'entity.name.function', settings: { foreground: '#DCDCAA' } },
    { scope: 'entity.name.type', settings: { foreground: '#4EC9B0' } },
    { scope: 'entity.name.class', settings: { foreground: '#4EC9B0' } },
    { scope: 'variable', settings: { foreground: '#9CDCFE' } },
    { scope: 'variable.language', settings: { foreground: '#569CD6' } },
    { scope: 'variable.parameter', settings: { foreground: '#9CDCFE' } },
    { scope: 'storage', settings: { foreground: '#569CD6' } },
    { scope: 'storage.type', settings: { foreground: '#569CD6' } },
    { scope: 'support.function', settings: { foreground: '#DCDCAA' } },
    { scope: 'support.type', settings: { foreground: '#4EC9B0' } },
    { scope: 'support.class', settings: { foreground: '#4EC9B0' } },
    { scope: 'support.variable', settings: { foreground: '#9CDCFE' } },
    { scope: 'support.constant', settings: { foreground: '#569CD6' } },
    { scope: 'punctuation.definition.string', settings: { foreground: '#CE9178' } },
    { scope: 'punctuation.separator', settings: { foreground: '#D4D4D4' } },
    { scope: 'meta.function-call', settings: { foreground: '#DCDCAA' } },
    { scope: 'keyword.control', settings: { foreground: '#C586C0' } },
    { scope: 'keyword.other', settings: { foreground: '#569CD6' } },
    { scope: 'invalid', settings: { foreground: '#F44747' } },
    { scope: 'string.regexp', settings: { foreground: '#D16969' } },
    { scope: 'constant.character.escape', settings: { foreground: '#D7BA7D' } },
];

/**
 * Embedded default token colors extracted from VS Code's light_plus.json.
 */
const LIGHT_DEFAULT_TOKEN_COLORS: RawTokenColor[] = [
    { scope: 'meta.embedded', settings: { foreground: '#000000' } },
    { scope: 'comment', settings: { foreground: '#008000' } },
    { scope: 'string', settings: { foreground: '#A31515' } },
    { scope: 'keyword', settings: { foreground: '#0000FF' } },
    { scope: 'keyword.operator', settings: { foreground: '#000000' } },
    { scope: 'keyword.operator.expression', settings: { foreground: '#0000FF' } },
    { scope: 'constant.numeric', settings: { foreground: '#098658' } },
    { scope: 'constant.language', settings: { foreground: '#0000FF' } },
    { scope: 'constant.character', settings: { foreground: '#0000FF' } },
    { scope: 'entity.name.function', settings: { foreground: '#795E26' } },
    { scope: 'entity.name.type', settings: { foreground: '#267F99' } },
    { scope: 'entity.name.class', settings: { foreground: '#267F99' } },
    { scope: 'variable', settings: { foreground: '#001080' } },
    { scope: 'variable.language', settings: { foreground: '#0000FF' } },
    { scope: 'variable.parameter', settings: { foreground: '#001080' } },
    { scope: 'storage', settings: { foreground: '#0000FF' } },
    { scope: 'storage.type', settings: { foreground: '#0000FF' } },
    { scope: 'support.function', settings: { foreground: '#795E26' } },
    { scope: 'support.type', settings: { foreground: '#267F99' } },
    { scope: 'support.class', settings: { foreground: '#267F99' } },
    { scope: 'support.variable', settings: { foreground: '#001080' } },
    { scope: 'support.constant', settings: { foreground: '#0000FF' } },
    { scope: 'punctuation.definition.string', settings: { foreground: '#A31515' } },
    { scope: 'punctuation.separator', settings: { foreground: '#000000' } },
    { scope: 'meta.function-call', settings: { foreground: '#795E26' } },
    { scope: 'keyword.control', settings: { foreground: '#AF00DB' } },
    { scope: 'keyword.other', settings: { foreground: '#0000FF' } },
    { scope: 'invalid', settings: { foreground: '#CD3131' } },
    { scope: 'string.regexp', settings: { foreground: '#811F3F' } },
    { scope: 'constant.character.escape', settings: { foreground: '#EE0000' } },
];

/**
 * High-contrast dark token colors.
 */
const HC_BLACK_DEFAULT_TOKEN_COLORS: RawTokenColor[] = [
    { scope: 'meta.embedded', settings: { foreground: '#FFFFFF' } },
    { scope: 'comment', settings: { foreground: '#7CA668' } },
    { scope: 'string', settings: { foreground: '#CE9178' } },
    { scope: 'keyword', settings: { foreground: '#569CD6' } },
    { scope: 'keyword.control', settings: { foreground: '#C586C0' } },
    { scope: 'constant.numeric', settings: { foreground: '#B5CEA8' } },
    { scope: 'constant.language', settings: { foreground: '#569CD6' } },
    { scope: 'entity.name.function', settings: { foreground: '#DCDCAA' } },
    { scope: 'entity.name.type', settings: { foreground: '#4EC9B0' } },
    { scope: 'variable', settings: { foreground: '#9CDCFE' } },
    { scope: 'support.function', settings: { foreground: '#DCDCAA' } },
    { scope: 'support.type', settings: { foreground: '#4EC9B0' } },
    { scope: 'storage', settings: { foreground: '#569CD6' } },
];

function getEmbeddedDefaultTokenColors(kind: vscode.ColorThemeKind): RawTokenColor[] {
    switch (kind) {
        case vscode.ColorThemeKind.Light:
            return LIGHT_DEFAULT_TOKEN_COLORS;
        case vscode.ColorThemeKind.Dark:
            return DARK_DEFAULT_TOKEN_COLORS;
        case vscode.ColorThemeKind.HighContrast:
            return HC_BLACK_DEFAULT_TOKEN_COLORS;
        case vscode.ColorThemeKind.HighContrastLight:
            return LIGHT_DEFAULT_TOKEN_COLORS;
        default:
            return DARK_DEFAULT_TOKEN_COLORS;
    }
}

type ContributedTheme = {
    id?: string;
    label?: string;
    path?: string;
    uiTheme?: string;
};

type ThemeSource = {
    base: ConsoleThemeData['base'];
    uri: vscode.Uri;
};

function stripJsonComments(content: string): string {
    let output = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
        const current = content[i];
        const next = i + 1 < content.length ? content[i + 1] : '';

        if (inLineComment) {
            if (current === '\n') {
                inLineComment = false;
                output += current;
            } else {
                output += ' ';
            }
            continue;
        }

        if (inBlockComment) {
            if (current === '*' && next === '/') {
                inBlockComment = false;
                output += '  ';
                i++;
            } else if (current === '\n') {
                output += '\n';
            } else {
                output += ' ';
            }
            continue;
        }

        if (inString) {
            output += current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '"') {
                inString = false;
            }
            continue;
        }

        if (current === '"') {
            inString = true;
            output += current;
            continue;
        }

        if (current === '/' && next === '/') {
            inLineComment = true;
            output += '  ';
            i++;
            continue;
        }

        if (current === '/' && next === '*') {
            inBlockComment = true;
            output += '  ';
            i++;
            continue;
        }

        output += current;
    }

    return output;
}

function stripTrailingCommas(content: string): string {
    let output = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
        const current = content[i];

        if (inString) {
            output += current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '"') {
                inString = false;
            }
            continue;
        }

        if (current === '"') {
            inString = true;
            output += current;
            continue;
        }

        if (current === ',') {
            let lookahead = i + 1;
            while (lookahead < content.length && /\s/.test(content[lookahead])) {
                lookahead++;
            }

            if (lookahead < content.length && (content[lookahead] === '}' || content[lookahead] === ']')) {
                continue;
            }
        }

        output += current;
    }

    return output;
}

function parseJsonc(content: string): ThemeDocument {
    const withoutComments = stripJsonComments(content);
    const withoutTrailingCommas = stripTrailingCommas(withoutComments);
    return JSON.parse(withoutTrailingCommas) as ThemeDocument;
}

/**
 * Positron-style theme bridge for console Monaco token colors.
 *
 * Uses `vscode.workspace.fs` (URI-based) so theme files can be read
 * transparently across local and remote environments (SSH, WSL, etc.).
 */
export class ConsoleThemeProvider {
    private readonly _cache = new Map<string, ThemeDocument>();

    async getConsoleThemeData(theme: vscode.ColorTheme = vscode.window.activeColorTheme): Promise<ConsoleThemeData> {
        const source = this._resolveActiveThemeSource(theme);
        const base = source?.base ?? BASE_BY_KIND[theme.kind] ?? 'vs-dark';

        let tokenColors: RawTokenColor[];
        if (source?.uri) {
            // User has an active theme with a known file – try to read it
            tokenColors = await this._collectTokenColors(source.uri);
        } else {
            // No theme file resolved (common on remote servers where
            // VS Code Server doesn't bundle theme-defaults). Skip the
            // file read to avoid noisy ENOENT warnings.
            tokenColors = [];
        }

        // Use embedded defaults when the theme file couldn't be read or
        // wasn't available
        const effectiveTokenColors = tokenColors.length > 0
            ? tokenColors
            : getEmbeddedDefaultTokenColors(theme.kind);

        const rules = this._flattenTokenColors(effectiveTokenColors);
        return { base, rules };
    }

    private _resolveActiveThemeSource(theme: vscode.ColorTheme): ThemeSource | undefined {
        const configuredTheme = vscode.workspace
            .getConfiguration('workbench')
            .get<string>('colorTheme');

        if (!configuredTheme) {
            return undefined;
        }

        for (const extension of vscode.extensions.all) {
            const themes = this._getContributedThemes(extension.packageJSON);
            for (const contributed of themes) {
                if (!contributed.path) {
                    continue;
                }

                const matches =
                    contributed.id === configuredTheme ||
                    contributed.label === configuredTheme;
                if (!matches) {
                    continue;
                }

                // Use URI-based path resolution so it works across local/remote
                const themeUri = vscode.Uri.joinPath(
                    extension.extensionUri,
                    contributed.path,
                );

                return {
                    base: this._uiThemeToBase(contributed.uiTheme, theme.kind),
                    uri: themeUri,
                };
            }
        }

        return undefined;
    }

    private _getContributedThemes(packageJson: unknown): ContributedTheme[] {
        if (!packageJson || typeof packageJson !== 'object') {
            return [];
        }

        const contributes = (packageJson as { contributes?: unknown }).contributes;
        if (!contributes || typeof contributes !== 'object') {
            return [];
        }

        const themes = (contributes as { themes?: unknown }).themes;
        if (!Array.isArray(themes)) {
            return [];
        }

        return themes.filter((theme): theme is ContributedTheme => {
            return !!theme && typeof theme === 'object';
        });
    }

    private _uiThemeToBase(
        uiTheme: string | undefined,
        fallbackKind: vscode.ColorThemeKind,
    ): ConsoleThemeData['base'] {
        switch (uiTheme) {
            case 'vs':
                return 'vs';
            case 'vs-dark':
                return 'vs-dark';
            case 'hc-black':
                return 'hc-black';
            case 'hc-light':
                return 'hc-light';
            default:
                return BASE_BY_KIND[fallbackKind] ?? 'vs-dark';
        }
    }

    private _resolveDefaultThemeUri(kind: vscode.ColorThemeKind): vscode.Uri {
        const fileName = THEME_FILE_BY_KIND[kind] ?? 'dark_plus.json';
        return vscode.Uri.joinPath(
            vscode.Uri.file(vscode.env.appRoot),
            'extensions',
            'theme-defaults',
            'themes',
            fileName,
        );
    }

    private async _collectTokenColors(themeUri: vscode.Uri, visited = new Set<string>()): Promise<RawTokenColor[]> {
        const key = themeUri.toString();
        if (visited.has(key)) {
            return [];
        }
        visited.add(key);

        const document = await this._readThemeDocument(themeUri);
        if (!document) {
            return [];
        }

        const inherited: RawTokenColor[] = [];
        if (document.include) {
            // Resolve include path relative to the current theme file's directory
            const includeUri = vscode.Uri.joinPath(themeUri, '..', document.include);
            inherited.push(...await this._collectTokenColors(includeUri, visited));
        }

        return [...inherited, ...(document.tokenColors ?? [])];
    }

    private async _readThemeDocument(themeUri: vscode.Uri): Promise<ThemeDocument | undefined> {
        const key = themeUri.toString();
        const cached = this._cache.get(key);
        if (cached) {
            return cached;
        }

        try {
            const bytes = await vscode.workspace.fs.readFile(themeUri);
            const content = new TextDecoder('utf-8').decode(bytes);
            const parsed = parseJsonc(content);
            this._cache.set(key, parsed);
            return parsed;
        } catch (error) {
            console.warn(`[ConsoleThemeProvider] Cannot read theme: ${themeUri.toString()}`, error);
            return undefined;
        }
    }

    private _flattenTokenColors(tokenColors: RawTokenColor[]): ConsoleThemeRule[] {
        const rules: ConsoleThemeRule[] = [];

        for (const item of tokenColors) {
            const scopes = item.scope;
            const settings = item.settings;
            if (!scopes || !settings) {
                continue;
            }

            const scopeList = Array.isArray(scopes) ? scopes : [scopes];
            for (const scope of scopeList) {
                if (!scope || typeof scope !== 'string') {
                    continue;
                }

                const token = scope.trim();
                if (!token) {
                    continue;
                }

                rules.push({
                    token,
                    foreground: this._normalizeColor(settings.foreground),
                    background: this._normalizeColor(settings.background),
                    fontStyle: settings.fontStyle,
                });
            }
        }

        return rules;
    }

    private _normalizeColor(color?: string): string | undefined {
        if (!color) {
            return undefined;
        }

        const normalized = color.trim();
        if (!normalized) {
            return undefined;
        }

        return normalized.startsWith('#') ? normalized.slice(1) : normalized;
    }
}
