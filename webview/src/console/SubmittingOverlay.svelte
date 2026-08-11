<script lang="ts">
    import { localize } from "$lib/localization";

    let { visible, onCancel }: { visible: boolean; onCancel: () => void } =
        $props();

    const label = $derived(
        localize("console.submitting", "Submitting..."),
    );
</script>

{#if visible}
    <div class="console-submitting-overlay-anchor">
        <div
            class="console-submitting-overlay"
            data-testid="console-submitting-overlay"
        >
            <span aria-label={label} class="label" role="status">
                {#each Array.from(label) as character, index (`${index}-${character}`)}
                    <span
                        aria-hidden="true"
                        class="label-character"
                        style:animation-delay={`${index * 80}ms`}
                    >{character}</span>
                {/each}
            </span>
            <button type="button" class="cancel" onclick={onCancel}>
                {localize("common.cancel", "Cancel")}
            </button>
        </div>
    </div>
{/if}

<style>
    .console-submitting-overlay-anchor {
        position: sticky;
        bottom: 16px;
        height: 0;
        z-index: 10;
    }

    .console-submitting-overlay {
        position: absolute;
        right: 16px;
        bottom: 0;
        width: fit-content;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 4px;
        background-color: var(--vscode-editorWidget-background);
        color: var(--vscode-editorWidget-foreground);
        border: 1px solid var(--vscode-editorWidget-border, transparent);
        box-shadow: 0 2px 8px var(--vscode-widget-shadow);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
    }

    .label {
        white-space: nowrap;
    }

    .label-character {
        display: inline-block;
        animation: submitting-wave 1.4s ease-in-out infinite;
    }

    .cancel {
        padding: 2px 10px;
        font: inherit;
        border: none;
        border-radius: 2px;
        cursor: pointer;
        color: var(--vscode-button-foreground);
        background-color: var(--vscode-button-background);
    }

    .cancel:hover {
        background-color: var(--vscode-button-hoverBackground);
    }

    @keyframes submitting-wave {
        0%,
        60%,
        100% {
            opacity: 1;
        }
        30% {
            opacity: 0.35;
        }
    }
</style>
