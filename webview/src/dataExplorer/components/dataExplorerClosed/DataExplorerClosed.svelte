<!--
  DataExplorerClosed.svelte - Closed state overlay
  Port from Positron's positronDataExplorerClosed.tsx
-->
<script lang="ts">
    export type DataExplorerClosedStatus = "unavailable" | "error";

    interface Props {
        closedReason: DataExplorerClosedStatus;
        errorMessage?: string;
        onClose: () => void;
    }

    let { closedReason, errorMessage = "", onClose }: Props = $props();

    const message = $derived.by(() => {
        if (closedReason === "error") {
            return "Error Opening Data Explorer";
        }
        return "Connection Closed";
    });

    const detailMessage = $derived.by(() => {
        if (closedReason === "error") {
            return errorMessage;
        }
        return "This object is no longer available.";
    });

    const closeLabel = "Close Data Explorer";
</script>

<div class="positron-data-explorer-closed">
    <div class="dialog-box">
        <div class="message">{message}</div>
        <div class="error-message">{detailMessage}</div>
        <button
            class="close-button"
            type="button"
            aria-label={closeLabel}
            onclick={onClose}
        >
            {closeLabel}
        </button>
    </div>
</div>

<style>
    .positron-data-explorer-closed {
        top: 0;
        left: 0;
        z-index: 30;
        width: 100%;
        height: 100%;
        display: grid;
        position: absolute;
        background-color: transparent;
        background: rgba(0, 0, 0, 0.05);
        grid-template-rows: [top-gutter] 1fr [dialog-box] max-content [bottom-gutter] 1fr [end-rows];
        grid-template-columns: [left-gutter] 1fr [dialog-box] max-content [right-gutter] 1fr [end-columns];
    }

    .positron-data-explorer-closed .dialog-box {
        display: flex;
        row-gap: 12px;
        font-size: 14px;
        cursor: pointer;
        max-width: 300px;
        padding: 20px;
        align-items: center;
        border-radius: 6px;
        flex-direction: column;
        grid-row: dialog-box / bottom-gutter;
        grid-column: dialog-box / right-gutter;
        box-shadow: 0 0 8px 2px var(--vscode-widget-shadow);
        color: var(--vscode-positronModalDialog-foreground);
        border: 1px solid var(--vscode-positronModalDialog-border);
        background-color: var(--vscode-positronModalDialog-background);
    }

    .positron-data-explorer-closed .dialog-box .message {
        font-size: 16px;
        font-weight: bold;
        text-align: center;
    }

    .positron-data-explorer-closed .dialog-box .error-message {
        text-align: left;
        max-height: 200px;
    }

    .positron-data-explorer-closed .dialog-box .close-button {
        display: flex;
        font-size: 14px;
        cursor: pointer;
        padding: 8px 16px;
        border-radius: 5px;
        align-items: center;
        justify-content: center;
        max-width: max-content;
        border: 1px solid var(--vscode-positronModalDialog-buttonBorder);
        color: var(--vscode-positronModalDialog-defaultButtonForeground);
        background: var(--vscode-positronModalDialog-defaultButtonBackground);
    }

    .positron-data-explorer-closed .dialog-box .close-button:hover {
        background: var(--vscode-positronModalDialog-defaultButtonHoverBackground);
    }

    .positron-data-explorer-closed .dialog-box .close-button:focus {
        outline: none;
    }

    .positron-data-explorer-closed .dialog-box .close-button:focus-visible {
        outline-offset: 2px;
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
