export interface InspectableConfigValue<T> {
    defaultValue?: T;
    defaultLanguageValue?: T;
    globalValue?: T;
    globalLanguageValue?: T;
    workspaceValue?: T;
    workspaceLanguageValue?: T;
    workspaceFolderValue?: T;
    workspaceFolderLanguageValue?: T;
}

export interface ResolveConsoleAppearanceOptions {
    configuredFontFamily?: string;
    editorFontFamily?: string;
    configuredFontSize?: number;
    configuredFontSizeInspection?: InspectableConfigValue<number>;
    editorFontSize?: number;
    configuredLineHeight?: number;
    configuredLineHeightInspection?: InspectableConfigValue<number>;
    editorLineHeight?: number;
}

export interface ResolvedConsoleAppearance {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

const DEFAULT_CONSOLE_FONT_SIZE = 14;
const DEFAULT_CONSOLE_LINE_HEIGHT = 1.4;
const MIN_CONSOLE_FONT_SIZE = 8;
const MAX_CONSOLE_FONT_SIZE = 32;
const MIN_CONSOLE_LINE_HEIGHT = 1;
const MAX_CONSOLE_LINE_HEIGHT = 3;

function hasExplicitConfigValue<T>(inspection?: InspectableConfigValue<T>): boolean {
    if (!inspection) {
        return false;
    }

    return (
        inspection.globalValue !== undefined ||
        inspection.workspaceValue !== undefined ||
        inspection.workspaceFolderValue !== undefined ||
        inspection.globalLanguageValue !== undefined ||
        inspection.workspaceLanguageValue !== undefined ||
        inspection.workspaceFolderLanguageValue !== undefined
    );
}

function clampFiniteNumber(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function normalizeFontFamily(
    configuredFontFamily: string | undefined,
    editorFontFamily: string | undefined,
): string {
    const trimmedConfiguredFontFamily = configuredFontFamily?.trim();
    if (trimmedConfiguredFontFamily) {
        return trimmedConfiguredFontFamily;
    }

    const trimmedEditorFontFamily = editorFontFamily?.trim();
    return trimmedEditorFontFamily || 'monospace';
}

function deriveEditorLineHeightRatio(
    editorLineHeight: number | undefined,
    fontSize: number,
): number {
    if (
        typeof editorLineHeight !== 'number' ||
        !Number.isFinite(editorLineHeight) ||
        editorLineHeight <= 0
    ) {
        return DEFAULT_CONSOLE_LINE_HEIGHT;
    }

    // Monaco treats values below 8 as a font-size multiplier.
    const effectiveLineHeightPx =
        editorLineHeight < 8 ? editorLineHeight * fontSize : editorLineHeight;

    return clampFiniteNumber(
        effectiveLineHeightPx / fontSize,
        DEFAULT_CONSOLE_LINE_HEIGHT,
        MIN_CONSOLE_LINE_HEIGHT,
        MAX_CONSOLE_LINE_HEIGHT,
    );
}

export function resolveConsoleAppearance(
    options: ResolveConsoleAppearanceOptions,
): ResolvedConsoleAppearance {
    const fontFamily = normalizeFontFamily(
        options.configuredFontFamily,
        options.editorFontFamily,
    );

    // The package.json defaults are static. Only explicit user/workspace values
    // should override the editor's font settings.
    const fontSizeSource = hasExplicitConfigValue(options.configuredFontSizeInspection)
        ? options.configuredFontSize
        : options.editorFontSize;
    const fontSize = clampFiniteNumber(
        fontSizeSource,
        DEFAULT_CONSOLE_FONT_SIZE,
        MIN_CONSOLE_FONT_SIZE,
        MAX_CONSOLE_FONT_SIZE,
    );

    const lineHeight = hasExplicitConfigValue(options.configuredLineHeightInspection)
        ? clampFiniteNumber(
            options.configuredLineHeight,
            DEFAULT_CONSOLE_LINE_HEIGHT,
            MIN_CONSOLE_LINE_HEIGHT,
            MAX_CONSOLE_LINE_HEIGHT,
        )
        : deriveEditorLineHeightRatio(options.editorLineHeight, fontSize);

    return {
        fontFamily,
        fontSize,
        lineHeight,
    };
}
