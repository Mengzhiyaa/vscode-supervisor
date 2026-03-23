<script lang="ts">
    /**
     * CustomSizeDialog.svelte - Dialog for setting custom plot dimensions
     * Follows Positron's modal dialog pattern for custom size input.
     */
    import { createEventDispatcher } from "svelte";

    interface Props {
        show: boolean;
        initialWidth?: number;
        initialHeight?: number;
    }

    let {
        show = $bindable(),
        initialWidth = 800,
        initialHeight = 600,
    }: Props = $props();

    const dispatch = createEventDispatcher<{
        submit: { width: number; height: number };
        cancel: void;
    }>();

    // svelte-ignore state_referenced_locally
    let width = $state(initialWidth);
    // svelte-ignore state_referenced_locally
    let height = $state(initialHeight);
    // svelte-ignore non_reactive_update
    let dialogElement: HTMLDialogElement;

    // Sync width/height when initial values change
    $effect(() => {
        width = initialWidth;
        height = initialHeight;
    });

    $effect(() => {
        if (show && dialogElement) {
            dialogElement.showModal();
        } else if (!show && dialogElement?.open) {
            dialogElement.close();
        }
    });

    function handleSubmit(e: Event) {
        e.preventDefault();
        if (width > 0 && height > 0) {
            dispatch("submit", { width, height });
            show = false;
        }
    }

    function handleCancel() {
        dispatch("cancel");
        show = false;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            handleCancel();
        }
    }

    // Preset sizes
    const presets = [
        { label: "800 × 600", width: 800, height: 600 },
        { label: "1024 × 768", width: 1024, height: 768 },
        { label: "1280 × 720", width: 1280, height: 720 },
        { label: "1920 × 1080", width: 1920, height: 1080 },
    ];

    function applyPreset(w: number, h: number) {
        width = w;
        height = h;
    }
</script>

{#if show}
    <dialog
        bind:this={dialogElement}
        class="custom-size-dialog"
        onkeydown={handleKeydown}
        onclose={handleCancel}
    >
        <form onsubmit={handleSubmit}>
            <h2>Custom Plot Size</h2>

            <div class="form-row">
                <label for="width">Width (px)</label>
                <input
                    type="number"
                    id="width"
                    bind:value={width}
                    min="100"
                    max="4096"
                    required
                />
            </div>

            <div class="form-row">
                <label for="height">Height (px)</label>
                <input
                    type="number"
                    id="height"
                    bind:value={height}
                    min="100"
                    max="4096"
                    required
                />
            </div>

            <div class="presets">
                <span class="presets-label">Presets:</span>
                {#each presets as preset}
                    <button
                        type="button"
                        class="preset-btn"
                        onclick={() => applyPreset(preset.width, preset.height)}
                    >
                        {preset.label}
                    </button>
                {/each}
            </div>

            <div class="actions">
                <button type="button" class="cancel-btn" onclick={handleCancel}>
                    Cancel
                </button>
                <button type="submit" class="submit-btn">Apply</button>
            </div>
        </form>
    </dialog>
{/if}

<style>
    .custom-size-dialog {
        padding: 0;
        border: 1px solid var(--vscode-widget-border, #454545);
        border-radius: 8px;
        background: var(--vscode-quickInput-background, #252526);
        color: var(--vscode-foreground, #cccccc);
        min-width: 320px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .custom-size-dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
    }

    form {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    h2 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
    }

    .form-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground, #8b8b8b);
    }

    input[type="number"] {
        background: var(--vscode-input-background, #3c3c3c);
        border: 1px solid var(--vscode-input-border, transparent);
        color: var(--vscode-input-foreground, #cccccc);
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 13px;
    }

    input[type="number"]:focus {
        outline: 1px solid var(--vscode-focusBorder, #007acc);
        border-color: var(--vscode-focusBorder, #007acc);
    }

    .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }

    .presets-label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground, #8b8b8b);
        margin-right: 4px;
    }

    .preset-btn {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #cccccc);
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
    }

    .preset-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
    }

    .cancel-btn {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #cccccc);
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
    }

    .cancel-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .submit-btn {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
    }

    .submit-btn:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
    }
</style>
