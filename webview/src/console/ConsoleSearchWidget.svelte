<!--
    ConsoleSearchWidget.svelte

    VS Code-style floating search widget for the console.
    Appears fixed at the top-right of the console instance.
    Mirrors VS Code Terminal's search widget appearance and behavior.
-->
<script lang="ts">
    interface Props {
        /** Whether the search widget is visible */
        visible: boolean;
        /** Bumps whenever the parent wants the find box refocused */
        focusRequest?: number;
        /** Total match count */
        matchCount: number;
        /** Current match index (0-based) */
        currentMatchIndex: number;
        /** Called when the search query or options change */
        onSearch: (
            query: string,
            options: {
                caseSensitive: boolean;
                useRegex: boolean;
                wholeWord: boolean;
            },
        ) => void;
        /** Called to navigate to the next match */
        onNextMatch: () => void;
        /** Called to navigate to the previous match */
        onPreviousMatch: () => void;
        /** Called when the widget should close */
        onClose: () => void;
    }

    let {
        visible,
        focusRequest = 0,
        matchCount,
        currentMatchIndex,
        onSearch,
        onNextMatch,
        onPreviousMatch,
        onClose,
    }: Props = $props();

    // Internal state
    let query = $state("");
    let caseSensitive = $state(false);
    let useRegex = $state(false);
    let wholeWord = $state(false);
    let inputElement = $state<HTMLInputElement | undefined>(undefined);
    let isInvalidRegex = $state(false);

    // Focus input when becoming visible
    $effect(() => {
        const input = inputElement;
        const request = focusRequest;
        if (visible && input) {
            requestAnimationFrame(() => {
                if (!visible || request !== focusRequest || input !== inputElement) {
                    return;
                }
                input.focus();
                input.select();
            });
        }
    });

    // Trigger search when query or options change
    $effect(() => {
        // Track dependencies
        const q = query;
        const cs = caseSensitive;
        const re = useRegex;
        const ww = wholeWord;

        // Validate regex
        if (re && q) {
            try {
                new RegExp(q);
                isInvalidRegex = false;
            } catch {
                isInvalidRegex = true;
            }
        } else {
            isInvalidRegex = false;
        }

        onSearch(q, { caseSensitive: cs, useRegex: re, wholeWord: ww });
    });

    function handleInputKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                onPreviousMatch();
            } else {
                onNextMatch();
            }
        }
    }

    function handleWidgetKeyDown(e: KeyboardEvent) {
        // Prevent keyboard events from propagating to the console instance
        // (except Escape which is handled in handleInputKeyDown)
        if (e.key !== "Escape") {
            e.stopPropagation();
        }
    }

    function toggleCaseSensitive() {
        caseSensitive = !caseSensitive;
    }

    function toggleWholeWord() {
        wholeWord = !wholeWord;
    }

    function toggleRegex() {
        useRegex = !useRegex;
    }

    // Match count display
    const matchCountText = $derived.by(() => {
        if (!query) return "";
        if (isInvalidRegex) return "Invalid regex";
        if (matchCount === 0) return "No results";
        return `${currentMatchIndex + 1} of ${matchCount}`;
    });

</script>

{#if visible}
    <div class="search-widget-shell">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="search-widget" onkeydown={handleWidgetKeyDown}>
            <div class="search-row">
                <div class="search-input-container" class:invalid={isInvalidRegex}>
                    <input
                        bind:this={inputElement}
                        bind:value={query}
                        class="search-input"
                        type="text"
                        placeholder="Find"
                        spellcheck="false"
                        autocomplete="off"
                        onkeydown={handleInputKeyDown}
                    />

                    <div class="search-input-controls">
                        <button
                            type="button"
                            class="option-button"
                            class:active={caseSensitive}
                            title="Match Case"
                            aria-label="Match Case"
                            onclick={toggleCaseSensitive}
                        >
                            <span class="codicon codicon-case-sensitive"></span>
                        </button>

                        <button
                            type="button"
                            class="option-button"
                            class:active={wholeWord}
                            title="Match Whole Word"
                            aria-label="Match Whole Word"
                            onclick={toggleWholeWord}
                        >
                            <span class="codicon codicon-whole-word"></span>
                        </button>

                        <button
                            type="button"
                            class="option-button"
                            class:active={useRegex}
                            title="Use Regular Expression"
                            aria-label="Use Regular Expression"
                            onclick={toggleRegex}
                        >
                            <span class="codicon codicon-regex"></span>
                        </button>
                    </div>
                </div>

                <span
                    class="match-count"
                    class:no-results={matchCount === 0 &&
                        query.length > 0 &&
                        !isInvalidRegex}
                >
                    {matchCountText}
                </span>

                <button
                    type="button"
                    class="nav-button previous-button"
                    title="Previous Match (Shift+Enter)"
                    aria-label="Previous Match"
                    disabled={matchCount === 0}
                    onclick={onPreviousMatch}
                >
                    <span class="codicon codicon-chevron-up"></span>
                </button>

                <button
                    type="button"
                    class="nav-button next-button"
                    title="Next Match (Enter)"
                    aria-label="Next Match"
                    disabled={matchCount === 0}
                    onclick={onNextMatch}
                >
                    <span class="codicon codicon-chevron-down"></span>
                </button>

                <button
                    type="button"
                    class="nav-button close-button"
                    title="Close (Escape)"
                    aria-label="Close"
                    onclick={onClose}
                >
                    <span class="codicon codicon-close"></span>
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .search-widget-shell {
        position: absolute;
        top: 0;
        right: 0;
        overflow: visible;
        width: min(419px, calc(100% - 64px));
        max-width: calc(100% - 18px);
        padding: 0 10px 10px;
        pointer-events: none;
        box-sizing: border-box;
        z-index: 1;
    }

    .search-widget {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        pointer-events: auto;
        box-sizing: border-box;
        padding: 4px;
        line-height: 19px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-editorWidget-foreground);
        border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
        border-bottom-left-radius: 4px;
        border-bottom-right-radius: 4px;
        box-shadow: 0 0 8px 2px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.16));
        font-size: 12px;
    }

    .search-row {
        display: flex;
        align-items: center;
        gap: 3px;
    }

    .search-input-container {
        position: relative;
        display: flex;
        flex: 1;
        align-items: center;
        min-width: 0;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 2px;
        min-height: 25px;
    }

    .search-input-container:focus-within {
        border-color: var(--vscode-focusBorder);
    }

    .search-input-container.invalid {
        border-color: var(--vscode-inputValidation-errorBorder, #be1100);
    }

    .search-input {
        width: 100%;
        min-width: 0;
        height: 23px;
        padding: 2px 70px 2px 6px;
        border: none;
        outline: none;
        background: transparent;
        color: var(--vscode-input-foreground);
        font-family: var(--console-ui-font-family);
        font-size: 13px;
        box-sizing: border-box;
    }

    .search-input::placeholder {
        color: var(--vscode-input-placeholderForeground);
    }

    .search-input-controls {
        position: absolute;
        top: 2px;
        right: 2px;
        display: flex;
        align-items: center;
        gap: 1px;
    }

    .option-button,
    .nav-button {
        min-width: 20px;
        width: 20px;
        height: 20px;
        line-height: 20px;
        padding: 0;
        border: none;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--vscode-editorWidget-foreground);
        cursor: pointer;
        box-sizing: border-box;
    }

    .option-button {
        border: 1px solid transparent;
        opacity: 0.75;
    }

    .option-button:hover,
    .nav-button:hover:not(:disabled) {
        background-color: var(--vscode-toolbar-hoverBackground);
        outline: 1px dashed var(--vscode-toolbar-hoverOutline, transparent);
        outline-offset: -1px;
    }

    .option-button.active {
        opacity: 1;
        background: var(
            --vscode-inputOption-activeBackground,
            rgba(0, 100, 200, 0.3)
        );
        color: var(--vscode-inputOption-activeForeground, inherit);
        border-color: var(--vscode-inputOption-activeBorder, transparent);
    }

    .match-count {
        width: 73px;
        min-width: 73px;
        max-width: 73px;
        height: 25px;
        padding: 2px 0 0 5px;
        text-align: left;
        font-size: 12px;
        color: var(--vscode-editorWidget-foreground);
        white-space: nowrap;
        line-height: 23px;
        box-sizing: border-box;
    }

    .match-count.no-results {
        color: var(--vscode-errorForeground);
    }

    .nav-button:disabled {
        opacity: 0.3 !important;
        cursor: default;
    }

    .close-button {
        margin-left: 2px;
    }

    @container (max-width: 360px) {
        .match-count {
            display: none;
        }
    }

    @container (max-width: 300px) {
        .option-button {
            display: none;
        }
    }

    @container (max-width: 230px) {
        .previous-button,
        .next-button {
            display: none;
        }
    }

    /* CSS Custom Highlight styles for search matches */
    :global(::highlight(console-search-matches)) {
        background-color: var(
            --vscode-editor-findMatchHighlightBackground,
            rgba(234, 92, 0, 0.33)
        );
    }

    :global(::highlight(console-search-current)) {
        background-color: var(
            --vscode-editor-findMatchBackground,
            rgba(255, 200, 0, 0.4)
        );
        outline: 1px solid var(--vscode-editor-findMatchBorder, transparent);
    }
</style>
