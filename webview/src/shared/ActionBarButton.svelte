<!--
  ActionBarButton.svelte
  Svelte port of Positron's ActionBarButton component.
  Standard toolbar button with icon, tooltip, disabled state.
-->
<script lang="ts">
    import '../shared/actionBar.css';

    interface Props {
        icon?: string;
        label?: string;
        ariaLabel: string;
        tooltip?: string;
        disabled?: boolean;
        fadeIn?: boolean;
        buttonClass?: string;
        iconClass?: string;
        onclick?: () => void;
    }

    let {
        icon,
        label,
        ariaLabel,
        tooltip,
        disabled = false,
        fadeIn = false,
        buttonClass = "",
        iconClass = "",
        onclick,
    }: Props = $props();
</script>

<button
    type="button"
    class={`action-bar-button ${buttonClass}`.trim()}
    class:has-label={!!label}
    class:fade-in={fadeIn}
    {disabled}
    title={tooltip || ariaLabel}
    aria-label={ariaLabel}
    onclick={onclick}
>
    <div aria-hidden="true" class="action-bar-button-face">
        {#if icon}
            <span
                class={`action-bar-button-icon codicon codicon-${icon} ${iconClass}`.trim()}
            ></span>
        {/if}
        {#if label}
            <span class="action-bar-button-label" style:margin-left={icon ? "0" : "4px"}>
                {label}
            </span>
        {/if}
    </div>
</button>

<style>
    .fade-in {
        animation: fadeIn 150ms ease-in;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
</style>
