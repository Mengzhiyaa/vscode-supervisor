<script lang="ts">
    import { onMount } from "svelte";
    import { localize } from "../nls";
    import PositronModalDialog from "./positronModalDialog/positronModalDialog.svelte";
    import Checkbox from "./positronModalDialog/components/checkbox.svelte";
    import ContentArea from "./positronModalDialog/components/contentArea.svelte";
    import PlatformNativeDialogActionBar from "./positronModalDialog/components/platformNativeDialogActionBar.svelte";

    interface Props {
        hasHeaderRow: boolean;
        availableSheets?: string[];
        selectedSheet?: string;
        onApply: (hasHeaderRow: boolean, sheetName?: string) => void;
        onCancel: () => void;
    }

    let { hasHeaderRow, availableSheets = [], selectedSheet, onApply, onCancel }: Props = $props();

    let nextHasHeaderRow = $state(false);
    let nextSelectedSheet = $state<string | undefined>();
    let primaryActionRef = $state<HTMLButtonElement | null>(null);

    const settingsChanged = $derived(
        nextHasHeaderRow !== hasHeaderRow || nextSelectedSheet !== selectedSheet,
    );

    $effect(() => {
        nextHasHeaderRow = hasHeaderRow;
        nextSelectedSheet = selectedSheet ?? availableSheets[0];
    });

    function handleApply() {
        if (settingsChanged) {
            onApply(nextHasHeaderRow, nextSelectedSheet);
            return;
        }

        onCancel();
    }

    onMount(() => {
        queueMicrotask(() => {
            primaryActionRef?.focus();
        });
    });
</script>

<PositronModalDialog
    title={localize("positron.fileOptionsModalDialogTitle", "File Options")}
    width={350}
    height={200}
    onCancel={onCancel}
>
    <ContentArea>
        <div class="file-options-content">
            <Checkbox
                initialChecked={hasHeaderRow}
                label={localize(
                    "positron.fileOptions.hasHeaderRow",
                    "First row contains column names",
                )}
                onChanged={(checked) => {
                    nextHasHeaderRow = checked;
                }}
            />
            {#if availableSheets.length > 0}
                <label class="worksheet-field">
                    <span>{localize("positron.fileOptions.worksheet", "Worksheet")}</span>
                    <select bind:value={nextSelectedSheet}>
                        {#each availableSheets as sheet}
                            <option value={sheet}>{sheet}</option>
                        {/each}
                    </select>
                </label>
            {/if}
        </div>
    </ContentArea>

    <div class="ok-cancel-action-bar">
        <PlatformNativeDialogActionBar>
            {#snippet secondaryButton()}
                <button class="action-bar-button" type="button" onclick={onCancel}>
                    {localize("positronCancel", "Cancel")}
                </button>
            {/snippet}
            {#snippet primaryButton()}
                <button
                    bind:this={primaryActionRef}
                    class="action-bar-button default"
                    type="button"
                    onclick={handleApply}
                >
                    {localize("positron.fileOptions.apply", "Apply")}
                </button>
            {/snippet}
        </PlatformNativeDialogActionBar>
    </div>
</PositronModalDialog>

<style>
    .file-options-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 0;
        white-space: normal;
    }

    .worksheet-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    select {
        color: var(--vscode-dropdown-foreground);
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px 6px;
    }
</style>
