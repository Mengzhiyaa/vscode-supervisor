import type { MessageConnection } from "vscode-jsonrpc/browser";
import type * as MonacoTypes from "monaco-editor";
import {
    type LanguageTextMateGrammarDefinition,
    ensureLanguageTextMateTokenizerReady,
    getLanguageTextMateGrammarDefinition,
    getTextMateThemeRules,
} from "./textMateTokenization";
type MonacoApi = typeof import("monaco-editor");

export interface ConsoleThemeRule {
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export interface ConsoleThemeData {
    base: "vs" | "vs-dark" | "hc-black" | "hc-light";
    rules: ConsoleThemeRule[];
}

export interface LanguageMonacoSupportModule {
    registerLanguage(monaco: MonacoApi): void;
    ensureTokenizerReady(monaco: MonacoApi): Promise<void>;
    ensureProviders?(monaco: MonacoApi): void;
    registerModel?(
        monaco: MonacoApi,
        model: MonacoTypes.editor.ITextModel,
        sessionId: string,
        connection: MessageConnection,
    ): void;
    unregisterModel?(monaco: MonacoApi, model: MonacoTypes.editor.ITextModel): void;
    getTextMateThemeRules?(): MonacoTypes.editor.ITokenThemeRule[];
    updateTextMateThemeRules?(theme: ConsoleThemeData): void;
}

type ModuleCacheEntry = {
    url: string;
    promise: Promise<LanguageMonacoSupportModule | undefined>;
};

const moduleCache = new Map<string, ModuleCacheEntry>();

function normalizeLanguageId(languageId: string): string {
    return languageId.trim().toLowerCase();
}

function isLanguageMonacoSupportModule(
    value: unknown,
): value is LanguageMonacoSupportModule {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as LanguageMonacoSupportModule).registerLanguage ===
            "function" &&
        typeof (value as LanguageMonacoSupportModule).ensureTokenizerReady ===
            "function"
    );
}

function normalizeLanguageMonacoSupportModule(
    value: unknown,
): LanguageMonacoSupportModule | undefined {
    let candidate = value;

    for (let depth = 0; depth < 3; depth += 1) {
        if (isLanguageMonacoSupportModule(candidate)) {
            return candidate;
        }

        if (
            typeof candidate !== "object" ||
            candidate === null ||
            !("default" in candidate)
        ) {
            return undefined;
        }

        candidate = (candidate as { default?: unknown }).default;
    }

    return undefined;
}

export function getLanguageMonacoSupportModuleUrl(
    languageId: string,
): string | undefined {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return undefined;
    }

    return globalThis.__arkLanguageMonacoSupportModules?.[normalizedLanguageId];
}

export {
    ensureLanguageTextMateTokenizerReady,
    getLanguageTextMateGrammarDefinition,
    getTextMateThemeRules,
    type LanguageTextMateGrammarDefinition,
};

export function loadLanguageMonacoSupportModule(
    languageId: string,
): Promise<LanguageMonacoSupportModule | undefined> {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return Promise.resolve(undefined);
    }

    const existingPromise = moduleCache.get(normalizedLanguageId);
    const moduleUrl = getLanguageMonacoSupportModuleUrl(normalizedLanguageId);
    if (!moduleUrl) {
        moduleCache.delete(normalizedLanguageId);
        return Promise.resolve(undefined);
    }

    if (existingPromise?.url === moduleUrl) {
        return existingPromise.promise;
    }

    const loadPromise = (async () => {
        const importedModule = await import(/* @vite-ignore */ moduleUrl);
        const normalizedModule =
            normalizeLanguageMonacoSupportModule(importedModule);

        if (!normalizedModule) {
            const exportKeys =
                importedModule &&
                typeof importedModule === "object"
                    ? Object.keys(importedModule)
                    : [];
            throw new Error(
                `Language Monaco support module '${normalizedLanguageId}' at '${moduleUrl}' did not expose a valid SPI. Export keys: ${exportKeys.join(", ") || "(none)"}`,
            );
        }

        return normalizedModule;
    })().catch((error) => {
            const currentEntry = moduleCache.get(normalizedLanguageId);
            if (currentEntry?.promise === loadPromise) {
                moduleCache.delete(normalizedLanguageId);
            }
            throw error;
        });

    moduleCache.set(normalizedLanguageId, {
        url: moduleUrl,
        promise: loadPromise,
    });
    return loadPromise;
}
