<script lang="ts">
    import { getDataExplorerContext } from '../positronDataExplorerContext';
    import { localize } from '../nls';

    const { instance, stores } = getDataExplorerContext();
    const { columnProfilesState } = stores;
    const retryingLabel = localize(
        'positron.dataExplorer.summaryProfilesNotice.retrying',
        'Calculating summaries...',
    );
    const pausedLabel = localize(
        'positron.dataExplorer.summaryProfilesPaused',
        'Summaries paused.',
    );
    const partialLabel = localize(
        'positron.dataExplorer.summaryProfilesFailed.partial',
        'Some summaries unavailable.',
    );
    const failedLabel = localize(
        'positron.dataExplorer.summaryProfilesFailed',
        'Summaries unavailable.',
    );
    const continueLabel = localize(
        'positron.dataExplorer.summaryProfilesPaused.continue',
        'Continue',
    );
    const retryLabel = localize('positron.dataExplorer.summaryProfilesFailed.retry', 'Retry');
</script>

{#if $columnProfilesState.failure || $columnProfilesState.retrying}
    <div class="summary-profiles-notice">
        <span
            aria-hidden="true"
            class="codicon {$columnProfilesState.retrying
                ? 'codicon-loading codicon-modifier-spin'
                : $columnProfilesState.failure === 'paused'
                  ? 'codicon-info'
                  : 'codicon-warning'}"
        ></span>
        <span class="message" role="status">
            {$columnProfilesState.retrying
                ? retryingLabel
                : $columnProfilesState.failure === 'paused'
                  ? pausedLabel
                  : $columnProfilesState.partial
                    ? partialLabel
                    : failedLabel}
        </span>
        {#if !$columnProfilesState.retrying && $columnProfilesState.failure !== 'disconnected'}
            <button
                type="button"
                onclick={() => instance.tableSummaryDataGridInstance.retryColumnProfiles()}
            >
                {$columnProfilesState.failure === 'paused' ? continueLabel : retryLabel}
            </button>
        {/if}
    </div>
{/if}

<style>
    .summary-profiles-notice {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--vscode-editorWidget-border);
    }
    .message {
        flex: 1;
    }
    button {
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
        border: 1px solid var(--vscode-button-border, transparent);
        cursor: pointer;
    }
    button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
