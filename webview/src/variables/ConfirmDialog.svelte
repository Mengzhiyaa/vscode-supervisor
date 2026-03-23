<script lang="ts">
    /**
     * ConfirmDialog.svelte
     * Confirmation dialog component for destructive actions like "Delete All Variables".
     * Matches Positron's DeleteAllVariablesModalDialog behavior.
     */

    interface Props {
        title: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        onConfirm: () => void;
        onCancel: () => void;
    }

    let {
        title,
        message,
        confirmLabel = "Delete",
        cancelLabel = "Cancel",
        onConfirm,
        onCancel,
    }: Props = $props();

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        } else if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
        }
    }

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="dialog-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
    tabindex="0"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
>
    <div class="dialog-container">
        <div class="dialog-header">
            <h2 id="dialog-title">{title}</h2>
        </div>
        <div class="dialog-body">
            <p>{message}</p>
        </div>
        <div class="dialog-footer">
            <button class="dialog-button secondary" onclick={onCancel}>
                {cancelLabel}
            </button>
            <button class="dialog-button danger" onclick={onConfirm}>
                {confirmLabel}
            </button>
        </div>
    </div>
</div>

<style>
    .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }

    .dialog-container {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        min-width: 320px;
        max-width: 450px;
        overflow: hidden;
    }

    .dialog-header {
        padding: 16px 20px 12px;
        border-bottom: 1px solid var(--vscode-widget-border);
    }

    .dialog-header h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
    }

    .dialog-body {
        padding: 16px 20px;
    }

    .dialog-body p {
        margin: 0;
        font-size: 13px;
        color: var(--vscode-foreground);
        line-height: 1.5;
    }

    .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px 16px;
        border-top: 1px solid var(--vscode-widget-border);
    }

    .dialog-button {
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        border: none;
    }

    .dialog-button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .dialog-button.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .dialog-button.danger {
        background: var(--vscode-inputValidation-errorBackground, #f44336);
        color: var(--vscode-inputValidation-errorForeground, white);
    }

    .dialog-button.danger:hover {
        opacity: 0.9;
    }
</style>
