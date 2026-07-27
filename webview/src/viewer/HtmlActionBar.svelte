<!--
  HtmlActionBar.svelte
  Toolbar for HTML-type previews.
  Mirrors: positron/htmlActionBars.tsx — title + reload/open actions/clear
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';
    import ViewerOpenMenuButton, { type ViewerOpenTarget } from './ViewerOpenMenuButton.svelte';
    import ActionBarSeparator from '../shared/ActionBarSeparator.svelte';
    import { localize } from '../lib/localization';

    interface Props {
        title?: string;
        onreload?: () => void;
        onclear?: () => void;
        defaultOpenTarget?: ViewerOpenTarget;
        onopen?: (target: ViewerOpenTarget) => void;
        onfind?: () => void;
    }

    let {
        title = '',
        onreload,
        onclear,
        defaultOpenTarget = 'browser',
        onopen,
        onfind,
    }: Props = $props();

</script>

<div class="preview-action-bar">
    <div
        class="html-action-bar positron-action-bar border-top border-bottom"
        role="toolbar"
        aria-label={localize('viewer.actions', 'Viewer actions')}
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
                ariaLabel={localize('viewer.reloadContent', 'Reload the content')}
                tooltip={localize('viewer.reloadContent', 'Reload the content')}
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
                ariaLabel={localize('viewer.clearContent', 'Clear the content')}
                tooltip={localize('viewer.clearContent', 'Clear the content')}
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
