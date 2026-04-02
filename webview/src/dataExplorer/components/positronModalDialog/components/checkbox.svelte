<script lang="ts">
    interface Props {
        label: string;
        initialChecked?: boolean;
        onChanged: (checked: boolean) => void;
    }

    let { label, initialChecked = false, onChanged }: Props = $props();

    const checkboxId =
        typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `checkbox-${Math.random().toString(36).slice(2)}`;

    let checked = $state(false);

    $effect(() => {
        checked = initialChecked;
    });

    function clickHandler() {
        checked = !checked;
        onChanged(checked);
    }
</script>

<div class="checkbox">
    <button
        id={checkboxId}
        aria-checked={checked}
        class="checkbox-button"
        role="checkbox"
        tabindex="0"
        type="button"
        onclick={clickHandler}
    >
        {#if checked}
            <div class="check-indicator codicon codicon-check"></div>
        {/if}
    </button>
    <label for={checkboxId}>{label}</label>
</div>

<style>
    .checkbox {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .checkbox-button {
        width: 16px;
        height: 16px;
        display: flex;
        cursor: pointer;
        border-radius: 3px;
        align-items: center;
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

    label {
        cursor: pointer;
        white-space: normal;
    }
</style>
