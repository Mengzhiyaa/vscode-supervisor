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
    }

    .suggestion-bar {
        width: 4px;
        display: flex;
        opacity: 0.75;
        background: var(--vscode-positronConsole-ansiYellow, var(--vscode-terminal-ansiYellow));
    }

    .suggestion-information {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        min-width: 0;
        padding: 2px 0;
    }

    .suggestion-action {
        display: grid;
        grid-template-columns: 2ch 1fr;
        align-items: center;
        border: 0;
        padding: 0;
        color: var(--vscode-textLink-foreground);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }

    .suggestion-icon {
        width: 1ch;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-positronConsole-ansiYellow, var(--vscode-terminal-ansiYellow));
    }

    .suggestion-action .link-text {
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

    .suggestion-action:disabled .suggestion-icon {
        color: inherit;
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
