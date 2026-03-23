<!--
  HtmlActionBar.svelte
  Toolbar for HTML-type previews.
  Mirrors: positron/htmlActionBars.tsx — title + reload/open actions/clear
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';
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
</script>

<div class="preview-action-bar">
    <div
        class="html-action-bar positron-action-bar border-top border-bottom"
        style="padding-left: 8px; padding-right: 8px;"
    >
        <div class="action-bar-region left">
            <span class="codicon codicon-file"></span>
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
            <ActionBarButton
                icon="link-external"
                ariaLabel="Open the content in the default browser"
                tooltip="Open the content in the default browser"
                onclick={onopenInBrowser}
            />
            <ActionBarSeparator />
            <ActionBarButton
                icon="positron-open-in-editor"
                ariaLabel="Open the content in an editor tab"
                tooltip="Open the content in an editor tab"
                onclick={onopenInEditor}
            />
            <ActionBarButton
                icon="positron-open-in-new-window"
                ariaLabel="Open the content in a new window"
                tooltip="Open the content in a new window"
                onclick={onopenInNewWindow}
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
