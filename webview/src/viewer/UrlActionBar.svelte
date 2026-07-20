<!--
  UrlActionBar.svelte
  Toolbar for URL-type previews.
  Mirrors: positron/urlActionBars.tsx — URL bar + back/forward/reload/clear/open actions/interrupt
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';
    import ActionBarMenuButton from '../shared/ActionBarMenuButton.svelte';
    import ActionBarSeparator from '../shared/ActionBarSeparator.svelte';

    interface Props {
        url: string;
        canNavigateBack: boolean;
        canNavigateForward: boolean;
        interruptible: boolean;
        interrupting: boolean;
        onnavigate?: (url: string) => void;
        onback?: () => void;
        onforward?: () => void;
        onreload?: () => void;
        onclear?: () => void;
        onopenInBrowser?: () => void;
        onopenInEditor?: () => void;
        onopenInNewWindow?: () => void;
        oninterrupt?: () => void;
    }

    let {
        url,
        canNavigateBack = false,
        canNavigateForward = false,
        interruptible = false,
        interrupting = false,
        onnavigate,
        onback,
        onforward,
        onreload,
        onclear,
        onopenInBrowser,
        onopenInEditor,
        onopenInNewWindow,
        oninterrupt,
    }: Props = $props();

    let urlInput = $state('');

    // Sync when external url changes
    $effect(() => {
        urlInput = url;
    });

    function handleSubmit(event: Event) {
        event.preventDefault();
        if (urlInput.trim()) {
            onnavigate?.(urlInput.trim());
        }
    }

    function resetUrlInput(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            urlInput = url;
            (event.currentTarget as HTMLInputElement).select();
        }
    }

    function openActions() {
        return [
            {
                id: 'open-browser',
                label: 'Open in Browser',
                icon: 'link-external',
                onSelected: () => onopenInBrowser?.(),
            },
            {
                id: 'open-editor',
                label: 'Open in Editor Tab',
                icon: 'positron-open-in-editor',
                onSelected: () => onopenInEditor?.(),
            },
            {
                id: 'open-window',
                label: 'Open in New Window',
                icon: 'positron-open-in-new-window',
                onSelected: () => onopenInNewWindow?.(),
            },
        ];
    }
</script>

<div class="preview-action-bar">
    <div
        class="url-action-bar positron-action-bar border-top border-bottom"
        role="toolbar"
        aria-label="Viewer actions"
        style="padding-left: 8px; padding-right: 8px;"
    >
        <div class="action-bar-region left">
            <ActionBarButton
                icon="positron-left-arrow"
                ariaLabel="Navigate back to the previous URL"
                tooltip="Navigate back to the previous URL"
                disabled={!canNavigateBack}
                onclick={onback}
            />
            <ActionBarButton
                icon="positron-right-arrow"
                ariaLabel="Navigate back to the next URL"
                tooltip="Navigate back to the next URL"
                disabled={!canNavigateForward}
                onclick={onforward}
            />
        </div>

        <div class="action-bar-region center">
            <form onsubmit={handleSubmit} aria-label="Navigate to URL">
                <input
                    type="text"
                    class="text-input url-bar"
                    bind:value={urlInput}
                    title={url}
                    aria-label="The current URL"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    onkeydown={resetUrlInput}
                />
            </form>
        </div>

        <div class="action-bar-region right">
            {#if interruptible}
                <ActionBarButton
                    icon="positron-interrupt-runtime"
                    buttonClass="interrupt"
                    ariaLabel="Interrupt execution"
                    tooltip="Interrupt execution"
                    disabled={interrupting}
                    onclick={oninterrupt}
                />
            {/if}
            <ActionBarButton
                icon="positron-refresh"
                ariaLabel="Reload the current URL"
                tooltip="Reload the current URL"
                onclick={onreload}
            />
            <ActionBarMenuButton
                icon="positron-open-in-new-window"
                ariaLabel="Select where to open"
                tooltip="Select where to open"
                align="right"
                actions={openActions}
            />
            <ActionBarSeparator />
            <ActionBarButton
                icon="clear-all"
                ariaLabel="Clear the current URL"
                tooltip="Clear the current URL"
                onclick={onclear}
            />
        </div>
    </div>
</div>

<style>
    .url-action-bar {
        width: 100%;
    }
</style>
