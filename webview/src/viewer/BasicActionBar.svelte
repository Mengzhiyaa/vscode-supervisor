<!--
  BasicActionBar.svelte
  Toolbar for basic previews.
  Mirrors: positron/basicActionBars.tsx — title + clear
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import './actionBars.css';
    import ActionBarButton from '../shared/ActionBarButton.svelte';

    interface Props {
        title?: string;
        onclear?: () => void;
    }

    let {
        title = '',
        onclear,
    }: Props = $props();
</script>

<div class="preview-action-bar">
    <div
        class="basic-action-bar positron-action-bar border-top border-bottom"
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
                icon="clear-all"
                ariaLabel="Clear the content"
                tooltip="Clear the content"
                onclick={onclear}
            />
        </div>
    </div>
</div>

<style>
    .basic-action-bar {
        width: 100%;
    }
</style>
