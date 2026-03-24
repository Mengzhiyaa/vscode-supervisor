<script lang="ts">
    import { onMount } from "svelte";
    import {
        ensureLanguageTextMateTokenizerReady,
        loadLanguageMonacoSupportModule,
    } from "$lib/monaco/languageSupport";

    type MonacoApi = typeof import("monaco-editor");
    type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
    type MonacoModel = import("monaco-editor").editor.ITextModel;

    interface Props {
        value?: string;
        language?: string;
    }

    let { value = "", language = "plaintext" }: Props = $props();

    let containerRef = $state<HTMLDivElement | null>(null);
    let monacoApi = $state<MonacoApi | null>(null);
    let editor = $state<MonacoEditor | null>(null);
    let model = $state<MonacoModel | null>(null);
    let languageSyncVersion = 0;

    async function ensureMonacoSupport(): Promise<MonacoApi> {
        const { ensureMonacoRuntime } = await import("$lib/monaco/setup");
        return ensureMonacoRuntime();
    }

    function resolveTheme(): string {
        const classList = document.body.classList;

        if (classList.contains("vscode-high-contrast-light")) {
            return "hc-light";
        }

        if (classList.contains("vscode-high-contrast")) {
            return "hc-black";
        }

        if (classList.contains("vscode-dark")) {
            return "vs-dark";
        }

        return "vs";
    }

    function resolveLanguageId(nextLanguage: string): string {
        const normalized = nextLanguage.trim().toLowerCase();

        if (!normalized) {
            return "plaintext";
        }

        if (
            normalized === "r" ||
            normalized.includes("tidyverse") ||
            normalized.includes("data.table")
        ) {
            return "r";
        }

        if (normalized.includes("python") || normalized.includes("pandas")) {
            return "python";
        }

        if (normalized.includes("polars")) {
            return "python";
        }

        if (normalized.includes("typescript")) {
            return "typescript";
        }

        if (normalized.includes("javascript") || normalized === "js") {
            return "javascript";
        }

        if (normalized.includes("sql")) {
            return "sql";
        }

        if (normalized.includes("json")) {
            return "json";
        }

        if (
            normalized.includes("shell") ||
            normalized === "sh" ||
            normalized === "bash"
        ) {
            return "shell";
        }

        return "plaintext";
    }

    async function ensureLanguageRegistered(languageId: string): Promise<void> {
        if (languageId !== "r" || !monacoApi) {
            return;
        }

        const languageSupport =
            await loadLanguageMonacoSupportModule(languageId);
        languageSupport?.registerLanguage(monacoApi);
        await ensureLanguageTextMateTokenizerReady(monacoApi, languageId);
    }

    async function syncModelLanguage(nextLanguageId: string): Promise<void> {
        const currentVersion = ++languageSyncVersion;
        await ensureLanguageRegistered(nextLanguageId);

        if (
            currentVersion !== languageSyncVersion ||
            !monacoApi ||
            !model ||
            model.getLanguageId() === nextLanguageId
        ) {
            return;
        }

        monacoApi.editor.setModelLanguage(model, nextLanguageId);
    }

    $effect(() => {
        if (!monacoApi || !model) {
            return;
        }

        const nextValue = value ?? "";
        if (model.getValue() !== nextValue) {
            model.setValue(nextValue);
        }

        const nextLanguageId = resolveLanguageId(language);
        void syncModelLanguage(nextLanguageId);
    });

    onMount(() => {
        let disposed = false;

        void (async () => {
            const runtime = await ensureMonacoSupport();
            if (disposed || !containerRef) {
                return;
            }

            const languageId = resolveLanguageId(language);
            await ensureLanguageRegistered(languageId);
            if (disposed || !containerRef) {
                return;
            }

            monacoApi = runtime;
            model = runtime.editor.createModel(value ?? "", languageId);
            editor = runtime.editor.create(containerRef, {
                model,
                theme: resolveTheme(),
                readOnly: true,
                contextmenu: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "bounded",
                wordWrapColumn: 2048,
                glyphMargin: false,
                folding: false,
                fixedOverflowWidgets: true,
                lineNumbers: "off",
                lineDecorationsWidth: 10,
                overviewRulerLanes: 0,
                rulers: [],
                renderLineHighlight: "none",
                renderValidationDecorations: "off",
                occurrencesHighlight: "off",
                selectionHighlight: false,
                scrollbar: {
                    useShadows: false,
                },
                padding: {
                    top: 10,
                    bottom: 10,
                },
            });
        })();

        return () => {
            disposed = true;
            editor?.dispose();
            model?.dispose();
        };
    });
</script>

<div bind:this={containerRef} class="read-only-code-editor"></div>

<style>
    .read-only-code-editor {
        width: 100%;
        height: 100%;
    }

    .read-only-code-editor :global(.monaco-editor),
    .read-only-code-editor :global(.monaco-editor .margin),
    .read-only-code-editor :global(.monaco-editor .monaco-editor-background) {
        background: var(--vscode-editor-background);
    }
</style>
