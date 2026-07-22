<script lang="ts">
    import '../shared/actionBar.css';
    import ContextMenu, { type ContextMenuEntry } from '../shared/ContextMenu.svelte';
    import { localize } from '../lib/localization';

    export type ViewerOpenTarget = 'browser' | 'editorTab' | 'newWindow';

    interface Props {
        defaultTarget?: ViewerOpenTarget;
        onopen?: (target: ViewerOpenTarget) => void;
    }

    let { defaultTarget = 'browser', onopen }: Props = $props();
    let menuVisible = $state(false);
    let menuButton = $state<HTMLButtonElement | null>(null);

    const targets: readonly { target: ViewerOpenTarget; label: string; icon: string }[] = [
        { target: 'browser', label: localize('common.openInBrowser', 'Open in Browser'), icon: 'link-external' },
        { target: 'editorTab', label: localize('common.openInEditorTab', 'Open in Editor Tab'), icon: 'positron-open-in-editor' },
        { target: 'newWindow', label: localize('common.openInNewWindow', 'Open in New Window'), icon: 'positron-open-in-new-window' },
    ];
    const selected = $derived(targets.find(item => item.target === defaultTarget) ?? targets[0]);

    function entries(): ContextMenuEntry[] {
        return targets.map(item => ({
            id: item.target,
            label: item.label,
            icon: item.icon,
            checked: item.target === defaultTarget,
            onSelected: () => onopen?.(item.target),
        }));
    }
</script>

<div class="viewer-open-button">
    <button
        type="button"
        class="action-bar-button primary"
        title={selected.label}
        aria-label={selected.label}
        onclick={() => onopen?.(defaultTarget)}
    >
        <span class="codicon codicon-{selected.icon}" aria-hidden="true"></span>
    </button>
    <button
        bind:this={menuButton}
        type="button"
        class="action-bar-button menu"
        title={localize('common.selectWhereToOpen', 'Select where to open')}
        aria-label={localize('common.selectWhereToOpen', 'Select where to open')}
        aria-haspopup="menu"
        aria-expanded={menuVisible}
        onclick={() => (menuVisible = !menuVisible)}
        onkeydown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                menuVisible = true;
            }
        }}
    >
        <span class="codicon codicon-positron-drop-down-arrow" aria-hidden="true"></span>
    </button>
</div>

{#if menuVisible && menuButton}
    <ContextMenu
        entries={entries()}
        anchorEl={menuButton}
        align="right"
        onclose={() => (menuVisible = false)}
    />
{/if}

<style>
    .viewer-open-button { display: flex; height: 24px; }
    .primary { width: 24px; border-radius: 4px 0 0 4px; }
    .menu { width: 16px; border-radius: 0 4px 4px 0; }
    .menu .codicon { font-size: 12px; }
    @media (forced-colors: active) {
        .viewer-open-button:focus-within { outline: 1px solid Highlight; }
    }
</style>
