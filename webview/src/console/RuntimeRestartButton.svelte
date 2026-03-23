<!--
  RuntimeRestartButton.svelte
  1:1 Positron replication - Restart button displayed after session exit
-->
<script lang="ts">
    // Props using Svelte 5 runes
    interface Props {
        languageName?: string;
        disabled?: boolean;
        onrestart?: () => void;
    }

    let { languageName = "R", disabled = false, onrestart }: Props = $props();

    // svelte-ignore non_reactive_update
    let buttonRef: HTMLButtonElement;
    // svelte-ignore state_referenced_locally
    let isDisabled = $state(disabled);

    // Sync isDisabled when disabled prop changes
    $effect(() => {
        isDisabled = disabled;
    });

    let restartLabel = $derived(`Restart ${languageName}`);

    function handleRestart() {
        // Disable the button to prevent mashing
        isDisabled = true;
        onrestart?.();
    }

    // Focus the button when console takes focus
    export function focus() {
        buttonRef?.focus();
    }
</script>

<button
    bind:this={buttonRef}
    class="monaco-text-button runtime-restart-button"
    disabled={isDisabled}
    onclick={handleRestart}
>
    <span class="codicon codicon-positron-restart-runtime"></span>
    <span class="label">{restartLabel}</span>
</button>

<style>
    .runtime-restart-button {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        margin-bottom: 10px;
        width: fit-content;
        padding-left: 10px;
        padding-right: 10px;
        border: none;
        background-color: var(--vscode-button-background);
        cursor: pointer;
    }

    .runtime-restart-button {
        color: var(--vscode-button-foreground);
    }

    .runtime-restart-button:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
    }

    .runtime-restart-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .label {
        line-height: 22px;
    }
</style>
