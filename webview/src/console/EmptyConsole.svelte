<script lang="ts">
    interface EmptyConsoleProps {
        readonly onStartSession?: () => void;
    }

    let { onStartSession = () => {} }: EmptyConsoleProps = $props();

    const noSessionRunning = "There is no session running.";
    const useWord = "Use";
    const startSession = "Start Session";
    const toStartOne = "to start one.";
</script>

<div class="empty-console">
    <div class="title">
        <span>{noSessionRunning} {useWord} </span>
        <button class="link" type="button" onclick={onStartSession}>
            {startSession}
        </button>
        <span> {toStartOne}</span>
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
</style>
