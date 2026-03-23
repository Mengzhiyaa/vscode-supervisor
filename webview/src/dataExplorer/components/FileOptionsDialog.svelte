<script lang="ts">
    import { onMount } from "svelte";
    import { localize } from "../nls";
    import PositronModalDialog from "./PositronModalDialog.svelte";

    interface Props {
        hasHeaderRow: boolean;
        onApply: (hasHeaderRow: boolean) => void;
        onCancel: () => void;
    }

    let { hasHeaderRow, onApply, onCancel }: Props = $props();

    let checkboxButtonRef = $state<HTMLButtonElement | null>(null);
    let nextHasHeaderRow = $state(false);
    const settingsChanged = $derived(nextHasHeaderRow !== hasHeaderRow);

    $effect(() => {
        nextHasHeaderRow = hasHeaderRow;
    });

    function toggleHeaderRow() {
        nextHasHeaderRow = !nextHasHeaderRow;
    }

    function handleApply() {
        if (settingsChanged) {
            onApply(nextHasHeaderRow);
            return;
        }

        onCancel();
    }

    onMount(() => {
        queueMicrotask(() => {
            checkboxButtonRef?.focus();
        });
    });
</script>

<PositronModalDialog
    title={localize("positron.fileOptionsModalDialogTitle", "File Options")}
    width={350}
    height={200}
    onCancel={onCancel}
>
    <div class="file-options-content">
        <div class="checkbox">
            <button
                bind:this={checkboxButtonRef}
                aria-checked={nextHasHeaderRow}
                class="checkbox-button"
                role="checkbox"
                tabindex="0"
                type="button"
                onclick={toggleHeaderRow}
            >
                {#if nextHasHeaderRow}
                    <div class="check-indicator codicon codicon-check"></div>
                {/if}
            </button>

            <button
                class="checkbox-label"
                type="button"
                onclick={toggleHeaderRow}
            >
                {localize(
                    "positron.fileOptions.hasHeaderRow",
                    "First row contains column names",
                )}
            </button>
        </div>
    </div>

    {#snippet footer()}
        <button class="action-bar-button" type="button" onclick={onCancel}>
            {localize("positronCancel", "Cancel")}
        </button>
        <button
            class="action-bar-button default"
            type="button"
            onclick={handleApply}
        >
            {localize("positron.fileOptions.apply", "Apply")}
        </button>
    {/snippet}
</PositronModalDialog>

<style>
    .file-options-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 0;
        white-space: normal;
    }

    .checkbox {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .checkbox-button {
        width: 16px;
        height: 16px;
        border: none;
        display: flex;
        cursor: pointer;
        border-radius: 3px;
        justify-content: center;
        color: var(--vscode-positronModalDialog-buttonForeground);
        background: var(--vscode-positronModalDialog-checkboxBackground);
        border: 1px solid var(--vscode-positronModalDialog-checkboxBorder);
    }

    .checkbox-button:focus {
        outline: none;
    }

    .checkbox-button:focus-visible {
        outline-offset: 2px;
        outline: 1px solid var(--vscode-focusBorder);
    }

    .checkbox-button .codicon {
        font-size: 12px;
        font-weight: 700;
        color: var(--vscode-positronModalDialog-checkboxForeground);
    }

    .checkbox-label {
        border: none;
        cursor: pointer;
        padding: 0;
        color: inherit;
        font: inherit;
        background: transparent;
        white-space: normal;
    }
</style>
