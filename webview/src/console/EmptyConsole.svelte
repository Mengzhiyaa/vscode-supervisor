<script lang="ts">
    import { localize } from "$lib/localization";
    interface EmptyConsoleProps {
        readonly onStartSession?: () => void;
    }

    let { onStartSession = () => {} }: EmptyConsoleProps = $props();

    const emptyPrefix = localize(
        "console.emptyPrefix",
        "There is no session running. Use",
    );
    const startSession = localize("console.startSession", "Start Session");
    const emptySuffix = localize("console.emptySuffix", "to start one.");
</script>

<div class="empty-console" role="status">
    <div class="title">
        <span>{emptyPrefix} </span>
        <button class="link" type="button" onclick={onStartSession}>
            {startSession}
        </button>
        <span> {emptySuffix}</span>
    </div>
</div>

<style>
    .empty-console {
        opacity: 0.75;
        box-sizing: border-box;
        border-top: 1px solid
            var(
                --vscode-positronActionBar-border,
                var(--vscode-terminal-border, transparent)
            );
    }

    .title {
        margin: 10px;
    }

    .link {
        display: inline;
        cursor: pointer;
        text-decoration: underline;
        color: var(--vscode-textLink-foreground);
        padding: 0;
        border: none;
        background: transparent;
        font: inherit;
    }

    .link:hover {
        color: var(--vscode-textLink-activeForeground);
    }

    .link:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
        border-radius: 2px;
    }
</style>
