<!--
  RowFilterParameter.svelte - Row filter parameter input (Svelte 5 runes mode)
  Port from Positron's rowFilterParameter.tsx
-->
<script lang="ts">
    interface Props {
        placeholder?: string;
        value?: string;
        autoFocus?: boolean;
        onTextChanged: (text: string) => void;
        onKeyDown?: (e: KeyboardEvent) => void;
    }

    let {
        placeholder = "",
        value = "",
        autoFocus = false,
        onTextChanged,
        onKeyDown,
    }: Props = $props();

    let inputRef = $state<HTMLInputElement | null>(null);
    let text = $state("");
    let focused = $state(false);

    $effect(() => {
        text = value;
    });

    $effect(() => {
        if (autoFocus && inputRef) {
            inputRef.focus();
        }
    });

    function handleInput(event: Event) {
        const target = event.target as HTMLInputElement;
        text = target.value;
        onTextChanged(target.value);
    }

    export function focus() {
        inputRef?.focus();
    }
</script>

<div class="row-filter-parameter-container">
    <div class="row-filter-parameter-input" class:focused>
        <input
            bind:this={inputRef}
            class="text-input"
            {placeholder}
            type="text"
            value={text}
            onblur={() => (focused = false)}
            oninput={handleInput}
            onfocus={() => (focused = true)}
            onkeydown={onKeyDown}
        />
    </div>
</div>

<style>
    .row-filter-parameter-container {
        height: 100%;
        display: flex;
        align-items: center;
    }

    .row-filter-parameter-input {
        width: 100%;
        display: flex;
        font-size: 12px;
        line-height: 16px;
        border-radius: 4px;
        align-items: center;
        background: var(--vscode-positronModalDialog-textInputBackground);
        border: 1px solid var(--vscode-positronDropDownListBox-border);
    }

    .row-filter-parameter-input.focused {
        border: 1px solid var(--vscode-focusBorder);
    }

    .row-filter-parameter-input .text-input {
        width: 100%;
        padding: 4px 8px;
        font: inherit;
        border-radius: 4px;
        box-sizing: border-box;
        border: none !important;
        color: inherit;
        background: transparent;
        outline: none !important;
    }

    .row-filter-parameter-input .text-input::placeholder {
        opacity: 0.75;
    }

    .row-filter-parameter-input .text-input::selection {
        color: var(--vscode-positronModalDialog-textInputSelectionForeground);
        background: var(
            --vscode-positronModalDialog-textInputSelectionBackground
        );
    }
</style>
