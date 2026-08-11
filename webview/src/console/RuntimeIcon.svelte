<!--
  RuntimeIcon.svelte
  1:1 Positron replication - Displays runtime icon based on session mode
-->
<script lang="ts">
    import type { SessionMode } from "../types/console";

    // Props using Svelte 5 runes
    interface Props {
        base64EncodedIconSvg?: string;
        sessionMode?: SessionMode;
        languageId?: string;
        fileIconThemeSettingsId?: string;
    }

    let {
        base64EncodedIconSvg,
        sessionMode = "console",
        languageId = "plaintext",
        fileIconThemeSettingsId,
    }: Props = $props();

    let isNotebook = $derived(sessionMode === "notebook");
    let setiIconThemeActive = $derived(fileIconThemeSettingsId === "vs-seti");
</script>

{#if isNotebook}
    <span class="icon codicon codicon-notebook"></span>
{:else if base64EncodedIconSvg}
    <img
        class="icon"
        src="data:image/svg+xml;base64,{base64EncodedIconSvg}"
        alt=""
        aria-hidden="true"
    />
{:else}
    <span
        class="icon language-icon file-icon {languageId}-lang-file-icon"
        class:seti-icon-theme-active={setiIconThemeActive}
        aria-hidden="true"
    >
        <span class="codicon codicon-terminal"></span>
    </span>
{/if}

<style>
    .icon {
        width: 15px;
        height: 15px;
        margin: 0 6px;
        flex-shrink: 0;
    }

    .codicon-notebook {
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .language-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        background-position: center;
        background-repeat: no-repeat;
        background-size: 15px;
    }

    .language-icon:not([style*="background-image"]) .codicon {
        font-size: 14px;
    }

    .seti-icon-theme-active {
        margin-left: 1px;
        margin-right: 6px;
    }
</style>
