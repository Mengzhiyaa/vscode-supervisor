<script lang="ts">
    import { getRpcConnection } from "$lib/rpc/client";
    import type { ActivityItemErrorSuggestion } from "./classes";
    import { localize } from "$lib/localization";

    interface Props {
        activityItemErrorSuggestion: ActivityItemErrorSuggestion;
        sessionId: string;
    }

    let { activityItemErrorSuggestion, sessionId }: Props = $props();
    let runningSuggestionId = $state<string | undefined>();
    let actionError = $state<string | undefined>();

    async function runSuggestion(suggestionId: string) {
        if (runningSuggestionId || !activityItemErrorSuggestion.available) {
            return;
        }

        runningSuggestionId = suggestionId;
        actionError = undefined;
        try {
            await getRpcConnection().sendRequest("console/runErrorSuggestion", {
                sessionId,
                itemId: activityItemErrorSuggestion.id,
                suggestionId,
            });
        } catch (error) {
            actionError = error instanceof Error ? error.message : String(error);
        } finally {
            runningSuggestionId = undefined;
        }
    }
</script>

<div class="activity-error-suggestion">
    <div class="suggestion-bar" aria-hidden="true"></div>
    <div class="suggestion-information">
        {#each activityItemErrorSuggestion.suggestions as suggestion (suggestion.id)}
            <button
                type="button"
                class="suggestion-action"
                disabled={!activityItemErrorSuggestion.available || !!runningSuggestionId}
                aria-busy={runningSuggestionId === suggestion.id}
                onclick={() => runSuggestion(suggestion.id)}
            >
                <span
                    class="suggestion-icon codicon codicon-{runningSuggestionId === suggestion.id ? 'loading spin' : suggestion.iconId}"
                    aria-hidden="true"
                ></span>
                <span class="link-text">{suggestion.label}</span>
            </button>
        {/each}
        {#if !activityItemErrorSuggestion.available}
            <span class="suggestion-status">{localize('console.suggestionUnavailable', 'Suggestion unavailable after restore')}</span>
        {/if}
        {#if actionError}
            <span class="suggestion-error" role="alert">{actionError}</span>
        {/if}
    </div>
</div>

<style>
    .activity-error-suggestion {
        display: grid;
        margin-left: -10px;
        grid-template-columns: 10px minmax(0, 1fr);
        background: var(--vscode-positronConsole-errorBackground, color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, transparent));
    }

    .suggestion-bar {
        width: 4px;
        opacity: 0.75;
        background: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground));
    }

    .suggestion-information {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 4px 0;
    }

    .suggestion-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        padding: 0;
        color: var(--vscode-textLink-foreground);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }

    .suggestion-action:hover:not(:disabled) .link-text {
        text-decoration: underline;
    }

    .suggestion-action:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
    }

    .suggestion-action:disabled {
        color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
        cursor: default;
    }

    .suggestion-status,
    .suggestion-error {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }

    .suggestion-error {
        color: var(--vscode-errorForeground);
    }

    @media (forced-colors: active) {
        .activity-error-suggestion {
            border-block: 1px solid CanvasText;
        }
    }
</style>
