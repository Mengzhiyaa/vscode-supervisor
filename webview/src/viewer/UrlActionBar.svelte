<!--
  UrlActionBar.svelte
  Toolbar for URL-type previews.
  Mirrors: positron/urlActionBars.tsx — URL bar + back/forward/reload/clear/open actions/interrupt
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';
    import ViewerOpenMenuButton, { type ViewerOpenTarget } from './ViewerOpenMenuButton.svelte';
    import ActionBarSeparator from '../shared/ActionBarSeparator.svelte';
    import { localize } from '../lib/localization';

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
        defaultOpenTarget?: ViewerOpenTarget;
        onopen?: (target: ViewerOpenTarget) => void;
        oninterrupt?: () => void;
        onfind?: () => void;
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
        defaultOpenTarget = 'browser',
        onopen,
        oninterrupt,
        onfind,
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

</script>

<div class="preview-action-bar">
    <div
        class="url-action-bar positron-action-bar border-top border-bottom"
        role="toolbar"
        aria-label={localize('viewer.actions', 'Viewer actions')}
        style="padding-left: 8px; padding-right: 8px;"
    >
        <div class="action-bar-region left">
            <ActionBarButton
                icon="positron-left-arrow"
                ariaLabel={localize('viewer.navigateBack', 'Navigate back to the previous URL')}
                tooltip={localize('viewer.navigateBack', 'Navigate back to the previous URL')}
                disabled={!canNavigateBack}
                onclick={onback}
            />
            <ActionBarButton
                icon="positron-right-arrow"
                ariaLabel={localize('viewer.navigateForward', 'Navigate forward to the next URL')}
                tooltip={localize('viewer.navigateForward', 'Navigate forward to the next URL')}
                disabled={!canNavigateForward}
                onclick={onforward}
            />
        </div>

        <div class="action-bar-region center">
            <form onsubmit={handleSubmit} aria-label={localize('viewer.navigateUrl', 'Navigate to URL')}>
                <input
                    type="text"
                    class="text-input url-bar"
                    bind:value={urlInput}
                    title={url}
                    aria-label={localize('viewer.currentUrl', 'The current URL')}
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
                    ariaLabel={localize('viewer.interrupt', 'Interrupt execution')}
                    tooltip={localize('viewer.interrupt', 'Interrupt execution')}
                    disabled={interrupting}
                    onclick={oninterrupt}
                />
            {/if}
            <ActionBarButton
                icon="positron-refresh"
                ariaLabel={localize('viewer.reloadUrl', 'Reload the current URL')}
                tooltip={localize('viewer.reloadUrl', 'Reload the current URL')}
                onclick={onreload}
            />
            <ActionBarButton
                icon="search"
                ariaLabel={localize('viewer.find', 'Find in preview')}
                tooltip={localize('viewer.find', 'Find in preview')}
                onclick={onfind}
            />
            <ViewerOpenMenuButton defaultTarget={defaultOpenTarget} {onopen} />
            <ActionBarSeparator />
            <ActionBarButton
                icon="clear-all"
                ariaLabel={localize('viewer.clearUrl', 'Clear the current URL')}
                tooltip={localize('viewer.clearUrl', 'Clear the current URL')}
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
