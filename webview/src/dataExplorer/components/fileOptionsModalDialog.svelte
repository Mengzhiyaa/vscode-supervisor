<script lang="ts">
    import { onMount } from "svelte";
    import { localize } from "../nls";
    import PositronModalDialog from "./positronModalDialog/positronModalDialog.svelte";
    import Checkbox from "./positronModalDialog/components/checkbox.svelte";
    import ContentArea from "./positronModalDialog/components/contentArea.svelte";
    import PlatformNativeDialogActionBar from "./positronModalDialog/components/platformNativeDialogActionBar.svelte";

    interface Props {
        hasHeaderRow: boolean;
        onApply: (hasHeaderRow: boolean) => void;
        onCancel: () => void;
    }

    let { hasHeaderRow, onApply, onCancel }: Props = $props();

    let nextHasHeaderRow = $state(false);
    let primaryActionRef = $state<HTMLButtonElement | null>(null);

    const settingsChanged = $derived(nextHasHeaderRow !== hasHeaderRow);

    $effect(() => {
        nextHasHeaderRow = hasHeaderRow;
    });

    function handleApply() {
        if (settingsChanged) {
            onApply(nextHasHeaderRow);
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
</style>
