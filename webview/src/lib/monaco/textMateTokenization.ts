import {
    createOnigScanner,
    createOnigString,
    loadWASM,
} from "vscode-oniguruma";
import {
    INITIAL,
    Registry,
    type IGrammar,
    type IRawGrammar,
    type StateStack,
} from "vscode-textmate";
import type * as MonacoTypes from "monaco-editor";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";
import type { ConsoleThemeData } from "./languageSupport";

type MonacoApi = typeof import("monaco-editor");

export interface LanguageTextMateGrammarDefinition {
    scopeName: string;
    grammarUrl: string;
}

type TokenizerCacheEntry = {
    grammarUrl: string;
    scopeName: string;
    promise: Promise<void>;
};

const tokenizerCache = new Map<string, TokenizerCacheEntry>();
const grammarCache = new Map<string, Promise<IRawGrammar>>();
let onigWasmReadyPromise: Promise<void> | undefined;

function normalizeLanguageId(languageId: string): string {
    return languageId.trim().toLowerCase();
}

function normalizeHexColor(color?: string): string | undefined {
    if (!color) {
        return undefined;
    }

    const trimmed = color.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

function loadArrayBuffer(url: string): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                resolve(xhr.response as ArrayBuffer);
                return;
            }

            reject(
                new Error(
                    `Failed to load '${url}': HTTP ${xhr.status}`,
                ),
            );
        };
        xhr.onerror = () =>
            reject(new Error(`Failed to load '${url}' via XHR`));
        xhr.send();
    });
}

async function loadText(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.text();
        }
    } catch {
        // Fall back to XHR below.
    }

    return new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "text";
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                resolve(xhr.responseText);
                return;
            }

            reject(
                new Error(
                    `Failed to load '${url}': HTTP ${xhr.status}`,
                ),
            );
        };
        xhr.onerror = () =>
            reject(new Error(`Failed to load '${url}' via XHR`));
        xhr.send();
    });
}

async function ensureOnigWasmReady(): Promise<void> {
    if (onigWasmReadyPromise) {
        return onigWasmReadyPromise;
    }

    onigWasmReadyPromise = (async () => {
        const wasmArrayBuffer = await loadArrayBuffer(onigWasmUrl);
        await loadWASM({ data: wasmArrayBuffer });
    })().catch((error) => {
        onigWasmReadyPromise = undefined;
        throw error;
    });

    return onigWasmReadyPromise;
}

async function loadGrammar(
    definition: LanguageTextMateGrammarDefinition,
): Promise<IRawGrammar> {
    const existingPromise = grammarCache.get(definition.grammarUrl);
    if (existingPromise) {
        return existingPromise;
    }

    const loadPromise = (async () => {
        const grammarText = await loadText(definition.grammarUrl);
        return JSON.parse(grammarText) as IRawGrammar;
    })().catch((error) => {
        const currentPromise = grammarCache.get(definition.grammarUrl);
        if (currentPromise === loadPromise) {
            grammarCache.delete(definition.grammarUrl);
        }
        throw error;
    });

    grammarCache.set(definition.grammarUrl, loadPromise);
    return loadPromise;
}

async function loadGrammarInstance(
    definition: LanguageTextMateGrammarDefinition,
): Promise<IGrammar | null> {
    await ensureOnigWasmReady();
    const rawGrammar = await loadGrammar(definition);

    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner,
            createOnigString,
        }),
        loadGrammar: async (scopeName: string): Promise<IRawGrammar | null> => {
            if (scopeName === definition.scopeName) {
                return rawGrammar;
            }

            return null;
        },
    });

    return registry.loadGrammar(definition.scopeName);
}

function scopesToMonacoToken(scopes: string[], rootScopeName: string): string {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
        if (scopes[index] !== rootScopeName) {
            return scopes[index];
        }
    }

    return "";
}

function registerTextMateTokensProvider(
    monaco: MonacoApi,
    languageId: string,
    rootScopeName: string,
    grammar: IGrammar,
): void {
    monaco.languages.setTokensProvider(languageId, {
        getInitialState(): MonacoTypes.languages.IState {
            return new TextMateState(INITIAL);
        },

        tokenize(
            line: string,
            state: MonacoTypes.languages.IState,
        ): MonacoTypes.languages.ILineTokens {
            const textMateState = state as TextMateState;
            const result = grammar.tokenizeLine(line, textMateState.ruleStack);

            return {
                tokens: result.tokens.map((token) => ({
                    startIndex: token.startIndex,
                    scopes: scopesToMonacoToken(token.scopes, rootScopeName),
                })),
                endState: new TextMateState(result.ruleStack),
            };
        },
    });
}

export function getLanguageTextMateGrammarDefinition(
    languageId: string,
): LanguageTextMateGrammarDefinition | undefined {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return undefined;
    }

    return globalThis.__arkLanguageTextMateGrammars?.[normalizedLanguageId];
}

export async function ensureLanguageTextMateTokenizerReady(
    monaco: MonacoApi,
    languageId: string,
): Promise<void> {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return;
    }

    const definition = getLanguageTextMateGrammarDefinition(normalizedLanguageId);
    if (!definition) {
        return;
    }

    const existingEntry = tokenizerCache.get(normalizedLanguageId);
    if (
        existingEntry &&
        existingEntry.grammarUrl === definition.grammarUrl &&
        existingEntry.scopeName === definition.scopeName
    ) {
        return existingEntry.promise;
    }

    const initPromise = (async () => {
        const grammar = await loadGrammarInstance(definition);
        if (!grammar) {
            console.warn(
                `[TextMate] Failed to load grammar '${definition.scopeName}' for '${normalizedLanguageId}'`,
            );
            return;
        }

        registerTextMateTokensProvider(
            monaco,
            normalizedLanguageId,
            definition.scopeName,
            grammar,
        );
    })().catch((error) => {
        const currentEntry = tokenizerCache.get(normalizedLanguageId);
        if (currentEntry?.promise === initPromise) {
            tokenizerCache.delete(normalizedLanguageId);
        }
        throw error;
    });

    tokenizerCache.set(normalizedLanguageId, {
        grammarUrl: definition.grammarUrl,
        scopeName: definition.scopeName,
        promise: initPromise,
    });

    return initPromise;
}

export function getTextMateThemeRules(
    theme: ConsoleThemeData,
): MonacoTypes.editor.ITokenThemeRule[] {
    return theme.rules.map((rule) => ({
        token: rule.token,
        foreground: normalizeHexColor(rule.foreground),
        background: normalizeHexColor(rule.background),
        fontStyle: rule.fontStyle,
    }));
}

class TextMateState implements MonacoTypes.languages.IState {
    constructor(public readonly ruleStack: StateStack) { }

    clone(): TextMateState {
        return new TextMateState(this.ruleStack.clone());
    }

    equals(other: MonacoTypes.languages.IState): boolean {
        return other instanceof TextMateState &&
            this.ruleStack.equals(other.ruleStack);
    }
}
