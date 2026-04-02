<script lang="ts">
    import { onMount } from "svelte";
    import {
        ensureLanguageTextMateTokenizerReady,
        loadLanguageMonacoSupportModule,
    } from "$lib/monaco/languageSupport";

    type MonacoApi = typeof import("monaco-editor");
    type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
    type MonacoModel = import("monaco-editor").editor.ITextModel;
    type MonacoEditorOptions =
        import("monaco-editor").editor.IStandaloneEditorConstructionOptions;

    interface Props {
        code?: string;
        language?: string;
        editorOptions?: MonacoEditorOptions;
    }

    let {
        code = "",
        language = "plaintext",
        editorOptions,
    }: Props = $props();

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

        const nextCode = code ?? "";
        if (model.getValue() !== nextCode) {
            model.setValue(nextCode);
        }

        const nextLanguageId = resolveLanguageId(language);
        void syncModelLanguage(nextLanguageId);
    });

    $effect(() => {
        if (!editor) {
            return;
        }

        editor.updateOptions(editorOptions ?? {});
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
            model = runtime.editor.createModel(code ?? "", languageId);
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
                ...editorOptions,
            });
        })();

        return () => {
            disposed = true;
            editor?.dispose();
            model?.dispose();
        };
    });
</script>

<div bind:this={containerRef} class="simple-code-editor"></div>

<style>
    .simple-code-editor {
        width: 100%;
        height: 100%;
    }

    .simple-code-editor :global(.monaco-editor),
    .simple-code-editor :global(.monaco-editor .margin),
    .simple-code-editor :global(.monaco-editor .monaco-editor-background) {
        background: var(--vscode-editor-background);
    }
</style>
