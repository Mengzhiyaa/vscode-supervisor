<!--
  HtmlActionBar.svelte
  Toolbar for HTML-type previews.
  Mirrors: positron/htmlActionBars.tsx — title + reload/open actions/clear
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';
    import ActionBarMenuButton from '../shared/ActionBarMenuButton.svelte';
    import ActionBarSeparator from '../shared/ActionBarSeparator.svelte';

    interface Props {
        title?: string;
        onreload?: () => void;
        onclear?: () => void;
        onopenInBrowser?: () => void;
        onopenInEditor?: () => void;
        onopenInNewWindow?: () => void;
    }

    let {
        title = '',
        onreload,
        onclear,
        onopenInBrowser,
        onopenInEditor,
        onopenInNewWindow,
    }: Props = $props();

    function openActions() {
        return [
            { id: 'open-browser', label: 'Open in Browser', icon: 'link-external', onSelected: () => onopenInBrowser?.() },
            { id: 'open-editor', label: 'Open in Editor Tab', icon: 'positron-open-in-editor', onSelected: () => onopenInEditor?.() },
            { id: 'open-window', label: 'Open in New Window', icon: 'positron-open-in-new-window', onSelected: () => onopenInNewWindow?.() },
        ];
    }
</script>

<div class="preview-action-bar">
    <div
        class="html-action-bar positron-action-bar border-top border-bottom"
        role="toolbar"
        aria-label="Viewer actions"
        style="padding-left: 8px; padding-right: 8px;"
    >
        <div class="action-bar-region left">
            <span class="codicon codicon-file" aria-hidden="true"></span>
        </div>
        <div class="action-bar-region center">
            <span class="preview-title" {title}>{title}</span>
        </div>
        <div class="action-bar-region right">
            <ActionBarButton
                icon="positron-refresh"
                ariaLabel="Reload the content"
                tooltip="Reload the content"
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
                ariaLabel="Clear the content"
                tooltip="Clear the content"
                onclick={onclear}
            />
        </div>
    </div>
</div>

<style>
    .html-action-bar {
        width: 100%;
    }
</style>
