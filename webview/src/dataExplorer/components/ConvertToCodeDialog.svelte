<script lang="ts">
    import { onMount } from "svelte";
    import { localize } from "../nls";
    import PositronModalDialog from "./PositronModalDialog.svelte";
    import ReadOnlyCodeEditor from "./ReadOnlyCodeEditor.svelte";
    import DropDownListBox, {
        type DropDownListBoxEntry,
    } from "./rowFilterBar/DropDownListBox.svelte";

    interface FocusableComponent {
        focus: () => void;
    }

    interface Props {
        syntaxes: string[];
        selectedSyntax?: string;
        previewCode?: string;
        previewError?: string;
        previewLoading?: boolean;
        onApply: (syntax: string) => void;
        onCancel: () => void;
        onSyntaxChange?: (syntax: string) => void;
    }

    let {
        syntaxes,
        selectedSyntax,
        previewCode = "",
        previewError,
        previewLoading = false,
        onApply,
        onCancel,
        onSyntaxChange,
    }: Props = $props();

    let syntaxDropDownRef = $state<FocusableComponent | null>(null);
    let chosenSyntax = $state("");
    let lastRequestedSyntax = $state("");

    const syntaxEntries = $derived.by((): DropDownListBoxEntry[] =>
        syntaxes.map((syntax) => ({
            identifier: syntax,
            title: syntax,
        })),
    );

    const canCopyCode = $derived(
        !!chosenSyntax && !previewLoading && !previewError && !!previewCode.trim(),
    );

    $effect(() => {
        const preferredSyntax =
            selectedSyntax && syntaxes.includes(selectedSyntax)
                ? selectedSyntax
                : syntaxes[0] ?? "";

        if (!chosenSyntax || !syntaxes.includes(chosenSyntax)) {
            chosenSyntax = preferredSyntax;
        }
    });

    $effect(() => {
        if (!chosenSyntax || chosenSyntax === lastRequestedSyntax) {
            return;
        }

        lastRequestedSyntax = chosenSyntax;
        onSyntaxChange?.(chosenSyntax);
    });

    onMount(() => {
        queueMicrotask(() => {
            syntaxDropDownRef?.focus();
        });
    });
</script>

<PositronModalDialog
    title={localize(
        "positronConvertToCodeModalDialogTitle",
        "Convert to Code",
    )}
    width={400}
    height={400}
    onCancel={onCancel}
>
    <div class="convert-to-code-dialog">
        <h3 class="code-syntax-heading">
            {localize(
                "positron.dataExplorer.codeSyntaxHeading",
                "Select code syntax",
            )}
        </h3>

        <div class="convert-to-code-syntax-dropdown">
            <DropDownListBox
                bind:this={syntaxDropDownRef}
                entries={syntaxEntries}
                selectedIdentifier={chosenSyntax}
                title={localize(
                    "positron.dataExplorer.selectCodeSyntax",
                    "Select Code Syntax",
                )}
                onSelectionChanged={(entry) => {
                    chosenSyntax = entry.identifier;
                }}
            />
        </div>

        <div
            class="convert-to-code-editor"
            aria-live="polite"
            aria-busy={previewLoading}
        >
            {#if previewLoading}
                <div class="editor-message editor-placeholder">
                    {localize(
                        "positron.dataExplorer.convertToCode.loading",
                        "Generating preview...",
                    )}
                </div>
            {:else if previewError}
                <div class="editor-message editor-error">{previewError}</div>
            {:else if previewCode.trim()}
                <ReadOnlyCodeEditor value={previewCode} language={chosenSyntax} />
            {:else}
                <div class="editor-message editor-placeholder">
                    {localize(
                        "positron.dataExplorer.convertToCode.empty",
                        "No preview is available for the current selection.",
                    )}
                </div>
            {/if}
        </div>
    </div>

    {#snippet footer()}
        <button class="action-bar-button" type="button" onclick={onCancel}>
            {localize("positronCancel", "Cancel")}
        </button>
        <button
            class="action-bar-button default"
            type="button"
            disabled={!canCopyCode}
            onclick={() => {
                if (canCopyCode) {
                    onApply(chosenSyntax);
                }
            }}
        >
            {localize("positron.dataExplorer.positronCopyCode", "Copy Code")}
        </button>
    {/snippet}
</PositronModalDialog>

<style>
    :global(.positron-modal-dialog-box .content-area) {
        padding-bottom: 0;
    }

    .convert-to-code-dialog {
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .code-syntax-heading {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
        white-space: normal;
    }

    .convert-to-code-syntax-dropdown {
        width: 100%;
        margin-bottom: 16px;
    }

    .convert-to-code-editor {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        border-radius: 3px;
        border: 1px solid var(--vscode-positronModalDialog-border);
        background: var(
            --vscode-editor-background,
            var(--vscode-positronModalDialog-background)
        );
    }

    .editor-message {
        height: 100%;
        margin: 0;
        padding: 10px;
        display: flex;
        align-items: flex-start;
        font-size: var(--vscode-editor-font-size, 12px);
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        font-family: var(--vscode-editor-font-family, monospace);
    }

    .editor-placeholder {
        color: var(--vscode-descriptionForeground);
    }

    .editor-error {
        color: var(--vscode-errorForeground);
    }
</style>
