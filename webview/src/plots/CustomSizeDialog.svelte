<script lang="ts">
    import { untrack } from "svelte";
    import { localize } from "$lib/localization";

    type SizeUnit = "px" | "in" | "cm" | "mm";
    /**
     * CustomSizeDialog.svelte - Dialog for setting custom plot dimensions
     * Follows Positron's modal dialog pattern for custom size input.
     */
    interface Props {
        show: boolean;
        initialWidth?: number;
        initialHeight?: number;
        onSubmit?: (size: { width: number; height: number }) => void;
        onCancel?: () => void;
    }

    let {
        show = $bindable(),
        initialWidth = 800,
        initialHeight = 600,
        onSubmit,
        onCancel,
    }: Props = $props();

    // svelte-ignore state_referenced_locally
    let width = $state(initialWidth);
    // svelte-ignore state_referenced_locally
    let height = $state(initialHeight);
    let unit = $state<SizeUnit>("px");
    let pixelsPerInch = $state(96);

    function unitScale(value: SizeUnit): number {
        switch (value) {
            case "in": return pixelsPerInch;
            case "cm": return pixelsPerInch / 2.54;
            case "mm": return pixelsPerInch / 25.4;
            default: return 1;
        }
    }

    const scale = $derived(unitScale(unit));
    const pixelWidth = $derived(Math.round(width * scale));
    const pixelHeight = $derived(Math.round(height * scale));
    const validSize = $derived(
        Number.isFinite(width) && Number.isFinite(height) &&
        pixelWidth >= 100 && pixelWidth <= 4096 &&
        pixelHeight >= 100 && pixelHeight <= 4096 &&
        (unit === "px" || (Number.isFinite(pixelsPerInch) && pixelsPerInch >= 1 && pixelsPerInch <= 1200)),
    );
    // svelte-ignore non_reactive_update
    let dialogElement: HTMLDialogElement;

    $effect(() => {
        if (show && dialogElement) {
            // Reset cancelled edits on every open, preserving the chosen unit.
            untrack(() => {
                if (!Number.isFinite(pixelsPerInch) || pixelsPerInch < 1 || pixelsPerInch > 1200) {
                    pixelsPerInch = 96;
                }
                width = initialWidth / scale;
                height = initialHeight / scale;
            });
            dialogElement.showModal();
        } else if (!show && dialogElement?.open) {
            dialogElement.close();
        }
    });

    function handleSubmit(e: Event) {
        e.preventDefault();
        if (validSize) {
            onSubmit?.({ width: pixelWidth, height: pixelHeight });
            show = false;
        }
    }

    function handleCancel() {
        onCancel?.();
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
        width = w / scale;
        height = h / scale;
    }

    function changeUnit(event: Event) {
        const nextUnit = (event.currentTarget as HTMLSelectElement).value as SizeUnit;
        const nextScale = unitScale(nextUnit);
        width = width * scale / nextScale;
        height = height * scale / nextScale;
        if (nextUnit === "px") {
            width = Math.round(width);
            height = Math.round(height);
        }
        unit = nextUnit;
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
            <h2>{localize("plots.customSizeTitle", "Custom Plot Size")}</h2>

            <div class="form-row">
                <label for="plot-size-unit">{localize("plots.sizeUnit", "Unit")}</label>
                <select id="plot-size-unit" value={unit} onchange={changeUnit}>
                    <option value="px">px</option>
                    <option value="in">in</option>
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                </select>
            </div>

            {#if unit !== "px"}
                <div class="form-row">
                    <label for="plot-size-resolution">{localize("plots.pixelsPerInch", "Pixels per inch (px/in)")}</label>
                    <input
                        type="number"
                        id="plot-size-resolution"
                        bind:value={pixelsPerInch}
                        min="1"
                        max="1200"
                        step="any"
                        required
                    />
                </div>
            {/if}

            <div class="form-row">
                <label for="width">{localize("plots.sizeWidth", "Width ({0})", unit)}</label>
                <input
                    type="number"
                    id="width"
                    bind:value={width}
                    min="0"
                    step={unit === "px" ? "1" : "any"}
                    required
                />
            </div>

            <div class="form-row">
                <label for="height">{localize("plots.sizeHeight", "Height ({0})", unit)}</label>
                <input
                    type="number"
                    id="height"
                    bind:value={height}
                    min="0"
                    step={unit === "px" ? "1" : "any"}
                    required
                />
            </div>

            <div class="size-preview" aria-live="polite">
                {#if validSize}
                    {localize("plots.pixelSizePreview", "Render size: {0} × {1} px", pixelWidth, pixelHeight)}
                {:else}
                    {localize("plots.sizeRange", "Each dimension must be between 100 and 4096 px.")}
                {/if}
            </div>

            <div class="presets">
                <span class="presets-label">{localize("plots.sizePresets", "Presets (px):")}</span>
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
                    {localize("plots.sizeCancel", "Cancel")}
                </button>
                <button type="submit" class="submit-btn" disabled={!validSize}>{localize("plots.sizeApply", "Apply")}</button>
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

    input[type="number"], select {
        background: var(--vscode-input-background, #3c3c3c);
        border: 1px solid var(--vscode-input-border, transparent);
        color: var(--vscode-input-foreground, #cccccc);
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 13px;
    }

    input[type="number"]:focus, select:focus {
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

    .size-preview {
        font-size: 12px;
        color: var(--vscode-descriptionForeground, #8b8b8b);
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

    .submit-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
