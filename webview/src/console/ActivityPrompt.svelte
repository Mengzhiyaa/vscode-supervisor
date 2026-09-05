<!--
    ActivityPrompt.svelte

    Renders an inline input prompt from the runtime (for example R's
    readline()). Non-password prompts use Monaco so selection, clipboard,
    undo, and context-menu behaviour matches the normal Console input.
-->
<script lang="ts">
    import { getContext, onMount, tick } from "svelte";
    import { monaco, ensureMonacoRuntime } from "$lib/monaco/setup";
    import { getRpcConnection } from "$lib/rpc/client";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";
    import OutputRun from "./OutputRun.svelte";
    import { ActivityItemPrompt, ActivityItemPromptState } from "./classes";
    import {
        promptInputControllersContext,
        type PromptInputController,
        type PromptInputControllers,
    } from "./services/promptInputController";
    import { writeClipboardText } from "./utils/selectionUtils";

    interface Props {
        activityItemPrompt: ActivityItemPrompt;
    }

    let { activityItemPrompt }: Props = $props();
    const isMacintosh = navigator.platform.toLowerCase().includes("mac");
    const promptInputs = getContext<PromptInputControllers | undefined>(
        promptInputControllersContext,
    );

    let passwordInputRef = $state<HTMLInputElement | undefined>(undefined);
    let editorContainerRef = $state<HTMLDivElement | undefined>(undefined);
    let passwordValue = $state("");
    let promptState = $state<ActivityItemPromptState>(
        ActivityItemPromptState.Unanswered,
    );
    let promptAnswer = $state("");
    let mounted = false;
    let destroyed = false;
    let editorInitialization = 0;
    let editorInitializationPromise: Promise<void> | undefined;
    let codeEditorWidget: monaco.editor.IStandaloneCodeEditor | undefined;
    let codeEditorModel: monaco.editor.ITextModel | undefined;
    let editorDisposables: monaco.IDisposable[] = [];
    let editorResizeObserver: ResizeObserver | undefined;

    $effect(() => {
        promptState = activityItemPrompt.state;
        promptAnswer = activityItemPrompt.answer ?? "";

        if (promptState !== ActivityItemPromptState.Unanswered) {
            disposeEditor();
        } else if (mounted && !activityItemPrompt.password) {
            void initializeEditor().catch(reportInputError);
        }
    });

    $effect(() => {
        const sessionId = activityItemPrompt.sessionId;
        if (!promptInputs || !sessionId || promptState !== ActivityItemPromptState.Unanswered) {
            return;
        }

        const controller: PromptInputController = {
            focus: readyInput,
            insertText: insertPromptText,
        };
        promptInputs.set(sessionId, controller);
        return () => {
            if (promptInputs.get(sessionId) === controller) {
                promptInputs.delete(sessionId);
            }
        };
    });

    onMount(() => {
        mounted = true;
        void readyInput().catch(reportInputError);

        return () => {
            destroyed = true;
            mounted = false;
            disposeEditor();
        };
    });

    function disposeEditor(): void {
        editorInitialization += 1;
        editorInitializationPromise = undefined;
        editorResizeObserver?.disconnect();
        editorResizeObserver = undefined;
        editorDisposables.forEach((disposable) => disposable.dispose());
        editorDisposables = [];
        codeEditorWidget?.dispose();
        codeEditorWidget = undefined;
        codeEditorModel?.dispose();
        codeEditorModel = undefined;
    }

    function initializeEditor(): Promise<void> {
        if (!editorInitializationPromise) {
            const pending = createEditor().finally(() => {
                if (editorInitializationPromise === pending) {
                    editorInitializationPromise = undefined;
                }
            });
            editorInitializationPromise = pending;
        }
        return editorInitializationPromise;
    }

    async function createEditor(): Promise<void> {
        if (
            destroyed ||
            codeEditorWidget ||
            activityItemPrompt.password ||
            promptState !== ActivityItemPromptState.Unanswered
        ) {
            return;
        }

        const initialization = ++editorInitialization;
        await tick();
        await ensureMonacoRuntime();
        if (
            destroyed ||
            initialization !== editorInitialization ||
            !editorContainerRef ||
            promptState !== ActivityItemPromptState.Unanswered
        ) {
            return;
        }

        const styles = getComputedStyle(editorContainerRef);
        const fontFamily =
            styles.getPropertyValue("--console-content-font-family").trim() ||
            styles.fontFamily ||
            "monospace";
        const fontSize = Number.parseFloat(
            styles.getPropertyValue("--console-content-font-size"),
        );
        const lineHeight = Math.max(
            16,
            Number.parseFloat(styles.lineHeight) ||
                (Number.isFinite(fontSize) ? fontSize * 1.4 : 20),
        );

        codeEditorModel = monaco.editor.createModel("", "plaintext");
        codeEditorWidget = monaco.editor.create(editorContainerRef, {
            model: codeEditorModel,
            automaticLayout: false,
            contextmenu: true,
            editContext: false,
            emptySelectionClipboard: false,
            folding: false,
            fontFamily,
            fontSize: Number.isFinite(fontSize) ? fontSize : 14,
            lineHeight,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbers: "off",
            minimap: { enabled: false },
            overviewRulerLanes: 0,
            padding: { top: 0, bottom: 0 },
            renderLineHighlight: "none",
            renderValidationDecorations: "off",
            scrollBeyondLastLine: false,
            scrollbar: {
                vertical: "hidden",
                horizontal: "hidden",
                useShadows: false,
                handleMouseWheel: false,
            },
            wordWrap: "off",
        });

        editorDisposables.push(
            codeEditorWidget.onKeyDown(handleEditorKeyDown),
            codeEditorWidget.onMouseDown((event) => {
                event.event.stopPropagation();
            }),
        );

        const container = editorContainerRef;
        const handlePaste = (event: ClipboardEvent) => {
            const pastedText = event.clipboardData?.getData("text/plain");
            if (!pastedText || !/[\r\n]/.test(pastedText)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            insertTextAtSelection(pastedText);
        };
        container.addEventListener("keydown", handleKeyDownCapture, true);
        container.addEventListener("paste", handlePaste, true);
        editorDisposables.push({
            dispose: () => {
                container.removeEventListener("keydown", handleKeyDownCapture, true);
                container.removeEventListener("paste", handlePaste, true);
            },
        });

        editorResizeObserver = new ResizeObserver(() => layoutEditor());
        editorResizeObserver.observe(container);
        layoutEditor();
        focusInput();
    }

    function layoutEditor(): void {
        if (!codeEditorWidget || !editorContainerRef) {
            return;
        }
        codeEditorWidget.layout({
            width: Math.max(100, editorContainerRef.clientWidth),
            height: Math.max(18, editorContainerRef.clientHeight),
        });
    }

    function insertTextAtSelection(text: string): void {
        const editor = codeEditorWidget;
        const model = codeEditorModel;
        const selection = editor?.getSelection();
        if (!editor || !model || !selection) {
            return;
        }

        const cleanedText = text.replace(/[\r\n]+/g, " ");
        const start = selection.getStartPosition();
        editor.pushUndoStop();
        editor.executeEdits("activity-prompt-paste", [
            { range: selection, text: cleanedText, forceMoveMarkers: true },
        ]);
        editor.pushUndoStop();
        editor.setPosition({
            lineNumber: start.lineNumber,
            column: start.column + cleanedText.length,
        });
    }

    async function readyInput(): Promise<void> {
        await tick();
        if (destroyed || promptState !== ActivityItemPromptState.Unanswered) {
            return;
        }
        if (!activityItemPrompt.password) {
            await initializeEditor();
        }
        focusInput();
    }

    function focusInput(): void {
        const container = activityItemPrompt.password ? passwordInputRef : editorContainerRef;
        // Focus newly requested prompts even after the ordinary input is hidden.
        // Hidden session tabs must not steal focus from the foreground session.
        if (destroyed || promptState !== ActivityItemPromptState.Unanswered ||
            !container?.getClientRects().length) {
            return;
        }
        container.scrollIntoView({ behavior: "auto" });
        if (activityItemPrompt.password) {
            passwordInputRef?.focus();
        } else {
            codeEditorWidget?.focus();
        }
    }

    async function insertPromptText(text: string): Promise<void> {
        await readyInput();
        if (destroyed || promptState !== ActivityItemPromptState.Unanswered) {
            return;
        }
        if (activityItemPrompt.password) {
            const input = passwordInputRef;
            if (!input) {
                return;
            }
            input.setRangeText(
                text.replace(/[\r\n]+/g, " "),
                input.selectionStart ?? input.value.length,
                input.selectionEnd ?? input.value.length,
                "end",
            );
            passwordValue = input.value;
        } else {
            insertTextAtSelection(text);
        }
    }

    function reportInputError(error: unknown): void {
        console.error("Failed to handle prompt input:", error);
    }

    async function pasteFromClipboard(): Promise<void> {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                await insertPromptText(text);
            }
        } catch (error) {
            reportInputError(error);
        }
    }

    function handleKeyDownCapture(event: KeyboardEvent): void {
        const cmdOrCtrl = isMacintosh
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey;
        if (!cmdOrCtrl || event.shiftKey || event.altKey) {
            return;
        }

        if (event.key.toLowerCase() === "v") {
            event.preventDefault();
            event.stopPropagation();
            void pasteFromClipboard();
        } else if (event.key.toLowerCase() === "a" && !activityItemPrompt.password) {
            event.preventDefault();
            event.stopPropagation();
            if (codeEditorModel) {
                codeEditorWidget?.setSelection(codeEditorModel.getFullModelRange());
            }
        }
    }

    function handleEditorKeyDown(event: monaco.IKeyboardEvent): void {
        if (event.keyCode === monaco.KeyCode.Enter) {
            event.preventDefault();
            event.stopPropagation();
            void submitAnswer(codeEditorWidget?.getValue() ?? "");
            return;
        }

        if (
            event.keyCode === monaco.KeyCode.KeyC &&
            event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey
        ) {
            event.preventDefault();
            event.stopPropagation();
            const selection = codeEditorWidget?.getSelection();
            if (isMacintosh || !selection || selection.isEmpty()) {
                void interruptPrompt();
            } else if (codeEditorModel) {
                void writeClipboardText(codeEditorModel.getValueInRange(selection));
            }
        }
    }

    function handlePasswordKeyDown(event: KeyboardEvent): void {
        event.stopPropagation();
        const noModifiers =
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey;
        const onlyCtrl =
            event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey;

        if (noModifiers && event.key === "Enter") {
            event.preventDefault();
            void submitAnswer(passwordValue);
        } else if (onlyCtrl && event.key.toLowerCase() === "c") {
            event.preventDefault();
            void interruptPrompt();
        }
    }

    async function submitAnswer(value: string): Promise<void> {
        try {
            await getRpcConnection().sendRequest("console/replyPrompt", {
                id: activityItemPrompt.id,
                value,
                sessionId: activityItemPrompt.sessionId,
            });
            promptState = ActivityItemPromptState.Answered;
            activityItemPrompt.state = ActivityItemPromptState.Answered;
            if (!activityItemPrompt.password) {
                promptAnswer = value;
                activityItemPrompt.answer = value;
            }
            disposeEditor();
        } catch (error) {
            console.error("Failed to reply to prompt:", error);
            await readyInput();
        }
    }

    async function interruptPrompt(): Promise<void> {
        try {
            await getRpcConnection().sendRequest("console/interrupt", {
                sessionId: activityItemPrompt.sessionId,
            });
            promptState = ActivityItemPromptState.Interrupted;
            activityItemPrompt.state = ActivityItemPromptState.Interrupted;
            disposeEditor();
        } catch (error) {
            console.error("Failed to interrupt prompt:", error);
            await readyInput();
        }
    }

    function stopPromptPropagation(event: Event): void {
        event.stopPropagation();
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="activity-prompt"
    data-session-id={activityItemPrompt.sessionId}
    data-prompt-state={promptState}
    onmousedown={stopPromptPropagation}
    onclick={stopPromptPropagation}
>
    {#if activityItemPrompt.outputLines.length > 1}
        <ConsoleOutputLines
            outputLines={activityItemPrompt.outputLines.slice(0, -1)}
        />
    {/if}

    <div class="prompt-line">
        {#each activityItemPrompt.outputLines.slice(-1) as outputLine (outputLine.id)}
            {#each outputLine.outputRuns as outputRun (outputRun.id)}
                <OutputRun {outputRun} />
            {/each}
        {/each}

        {#if promptState === ActivityItemPromptState.Unanswered}
            {#if activityItemPrompt.password}
                <input
                    bind:this={passwordInputRef}
                    bind:value={passwordValue}
                    class="password-input"
                    type="password"
                    onkeydowncapture={handleKeyDownCapture}
                    onkeydown={handlePasswordKeyDown}
                    onmousedown={stopPromptPropagation}
                    onclick={stopPromptPropagation}
                />
            {:else}
                <div
                    bind:this={editorContainerRef}
                    class="editor-input-container"
                ></div>
            {/if}
        {:else if promptState === ActivityItemPromptState.Answered}
            {#if !activityItemPrompt.password}
                <span class="prompt-answer">{promptAnswer}</span>
            {/if}
        {/if}
    </div>
</div>

<style>
    .activity-prompt {
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
        padding-bottom: 10px;
    }

    .prompt-line {
        display: flex;
        min-height: 20px;
        margin-right: 10px;
        align-items: center;
        flex-wrap: nowrap;
        white-space: pre;
    }

    .editor-input-container,
    .password-input {
        flex: 1 1 auto;
        min-width: 100px;
        height: 20px;
    }

    .password-input {
        padding: 0;
        margin: 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--vscode-editor-foreground);
        font: inherit;
    }

    .editor-input-container :global(.monaco-editor),
    .editor-input-container :global(.monaco-editor .margin),
    .editor-input-container :global(.monaco-editor-background) {
        background: transparent !important;
    }

    .prompt-answer {
        color: var(--vscode-editor-foreground);
    }
</style>
