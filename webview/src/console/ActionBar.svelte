<!--
    ActionBar.svelte

    Toolbar component for console actions.
    Uses DynamicActionBar for overflow support.
    Mirrors: positron/.../components/actionBar.tsx
-->
<script lang="ts">
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import type { ConsoleState } from "../types/console";
    import DynamicActionBar, {
        type DynamicAction,
    } from "../shared/DynamicActionBar.svelte";
    import CurrentWorkingDirectory from "./CurrentWorkingDirectory.svelte";
    import ConsoleInfoButton from "./ConsoleInfoButton.svelte";
    
    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        state: ConsoleState;
        runtimePath?: string;
        runtimeVersion?: string;
        runtimeSource?: string;
    }

    interface ActionBarProps {
        readonly currentWorkingDirectory: string;
        readonly stateLabel: string;
        readonly interruptible: boolean;
        readonly interrupting: boolean;
        readonly restarting: boolean;
        readonly showDeleteButton?: boolean;
        readonly canShutdown: boolean;
        readonly canStart: boolean;
        readonly traceEnabled: boolean;
        readonly session?: SessionInfo;
        readonly onInterrupt: () => void;
        readonly onRestart: () => void;
        readonly onClear: () => void;
        readonly onToggleWordWrap: () => void;
        readonly onToggleTrace: () => void;
        readonly onDeleteSession: () => void;
        readonly onOpenInEditor: () => void;
    }

    let {
        currentWorkingDirectory,
        stateLabel,
        interruptible,
        interrupting,
        restarting,
        showDeleteButton = false,
        canShutdown,
        canStart,
        traceEnabled,
        session,
        onInterrupt,
        onRestart,
        onClear,
        onToggleWordWrap,
        onToggleTrace,
        onDeleteSession,
        onOpenInEditor,
    }: ActionBarProps = $props();

    // Localized strings (Positron pattern)
    const positronInterruptExecution = "Interrupt Execution";
    const positronRestartSession = "Restart Session";
    const positronToggleWordWrap = "Toggle Word Wrap";
    const positronClearConsole = "Clear Console";
    const positronToggleTrace = "Toggle Trace";
    const positronDeleteSession = "Delete Session";
    const positronOpenInEditor = "Open in Editor";

    // --- Build DynamicActionBar actions ---
    const leftActions: DynamicAction[] = $derived.by(() => [
        {
            fixedWidth: 24,
            text: currentWorkingDirectory,
            minWidth: 84,
            separator: false,
            component: cwdSnippet,
        },
    ]);

    const rightActions: DynamicAction[] = $derived.by(() => {
        const actions: DynamicAction[] = [];

        // State label (Positron: appears first, followed by separator)
        if (stateLabel.length) {
            actions.push({
                fixedWidth: 4,
                text: stateLabel,
                minWidth: 28,
                separator: false,
                component: stateLabelSnippet,
            });
        }

        // Interrupt (conditional, separator after interrupt group)
        if (interruptible) {
            actions.push({
                fixedWidth: 24,
                separator: false,
                component: interruptSnippet,
                overflowMenuItem: {
                    label: positronInterruptExecution,
                    icon: "positron-interrupt-runtime",
                    disabled: interrupting,
                    onSelected: () => onInterrupt(),
                },
            });
        }

        // Restart (separator after restart, before word wrap group)
        actions.push({
            fixedWidth: 24,
            separator: true,
            component: restartSnippet,
            overflowMenuItem: {
                label: positronRestartSession,
                icon: "positron-restart-runtime-thin",
                disabled: !canShutdown || restarting,
                onSelected: () => onRestart(),
            },
        });

        if (showDeleteButton) {
            actions.push({
                fixedWidth: 24,
                separator: false,
                component: deleteSnippet,
                overflowMenuItem: {
                    label: positronDeleteSession,
                    icon: "trash",
                    disabled: !(canShutdown || canStart),
                    onSelected: () => onDeleteSession(),
                },
            });
        }

        // Console Info (separator after, before trace/word wrap group)
        actions.push({
            fixedWidth: 24,
            separator: true,
            component: consoleInfoSnippet,
        });

        if (import.meta.env.DEV || traceEnabled) {
            actions.push({
                fixedWidth: 24,
                separator: false,
                component: traceSnippet,
                overflowMenuItem: {
                    label: positronToggleTrace,
                    icon: "wand",
                    onSelected: () => onToggleTrace(),
                },
            });
        }

        // Toggle Word Wrap
        actions.push({
            fixedWidth: 24,
            separator: true,
            component: wordWrapSnippet,
            overflowMenuItem: {
                label: positronToggleWordWrap,
                icon: "word-wrap",
                onSelected: () => onToggleWordWrap(),
            },
        });

        // Open in Editor
        actions.push({
            fixedWidth: 24,
            separator: true,
            component: openInEditorSnippet,
            overflowMenuItem: {
                label: positronOpenInEditor,
                icon: "positron-open-in-editor",
                onSelected: () => onOpenInEditor(),
            },
        });

        // Clear console (last, no separator)
        actions.push({
            fixedWidth: 24,
            separator: false,
            component: clearSnippet,
            overflowMenuItem: {
                label: positronClearConsole,
                icon: "clear-all",
                onSelected: () => onClear(),
            },
        });

        return actions;
    });
</script>

<!-- Svelte Snippets -->
{#snippet cwdSnippet()}
    <CurrentWorkingDirectory directoryLabel={currentWorkingDirectory} />
{/snippet}

{#snippet stateLabelSnippet()}
    <div class="state-label">{stateLabel}</div>
{/snippet}

{#snippet interruptSnippet()}
    <ActionBarButton
        icon="positron-interrupt-runtime"
        buttonClass="interrupt"
        ariaLabel={positronInterruptExecution}
        tooltip={positronInterruptExecution}
        disabled={interrupting}
        onclick={() => onInterrupt()}
    />
{/snippet}

{#snippet restartSnippet()}
    <ActionBarButton
        icon="positron-restart-runtime-thin"
        ariaLabel={positronRestartSession}
        tooltip={positronRestartSession}
        disabled={!canShutdown || restarting}
        onclick={() => onRestart()}
    />
{/snippet}

{#snippet deleteSnippet()}
    <ActionBarButton
        icon="trash"
        ariaLabel={positronDeleteSession}
        tooltip={positronDeleteSession}
        disabled={!(canShutdown || canStart)}
        onclick={() => onDeleteSession()}
    />
{/snippet}

{#snippet consoleInfoSnippet()}
    <ConsoleInfoButton {session} />
{/snippet}

{#snippet traceSnippet()}
    <ActionBarButton
        icon="wand"
        ariaLabel={positronToggleTrace}
        tooltip={positronToggleTrace}
        onclick={() => onToggleTrace()}
    />
{/snippet}

{#snippet wordWrapSnippet()}
    <ActionBarButton
        icon="word-wrap"
        ariaLabel={positronToggleWordWrap}
        tooltip={positronToggleWordWrap}
        onclick={() => onToggleWordWrap()}
    />
{/snippet}

{#snippet openInEditorSnippet()}
    <ActionBarButton
        icon="positron-open-in-editor"
        ariaLabel={positronOpenInEditor}
        tooltip={positronOpenInEditor}
        onclick={() => onOpenInEditor()}
    />
{/snippet}

{#snippet clearSnippet()}
    <ActionBarButton
        icon="clear-all"
        ariaLabel={positronClearConsole}
        tooltip={positronClearConsole}
        onclick={() => onClear()}
    />
{/snippet}

<div class="console-action-bar" data-trace-enabled={traceEnabled}>
    <DynamicActionBar
        {leftActions}
        {rightActions}
        paddingLeft={8}
        paddingRight={8}
        borderTop={true}
        borderBottom={true}
    />
</div>

<style>
    .console-action-bar {
        --positron-action-bar-bg: var(
            --vscode-positronActionBar-background,
            var(--vscode-editor-background)
        );
        --positron-action-bar-border: var(
            --vscode-positronActionBar-border,
            var(--vscode-panel-border)
        );
        --console-action-bar-foreground: var(
            --vscode-positronActionBar-foreground,
            var(--vscode-foreground)
        );
        --console-action-bar-hover-background: var(
            --vscode-positronActionBar-hoverBackground,
            var(--vscode-toolbar-hoverBackground)
        );
    }

    .console-action-bar :global(.positron-dynamic-action-bar) {
        height: var(--vscode-positronActionBar-height, 28px);
    }

    .console-action-bar :global(.action-bar-button),
    .console-action-bar :global(.action-bar-menu-button) {
        width: 24px;
        justify-content: center;
        color: var(--console-action-bar-foreground);
    }

    .console-action-bar :global(.action-bar-button:disabled) {
        opacity: 0.4;
    }

    .console-action-bar :global(.action-bar-button:hover:not(:disabled)),
    .console-action-bar :global(.action-bar-menu-button:hover:not(:disabled)) {
        background: var(--console-action-bar-hover-background);
    }

    .console-action-bar :global(.action-bar-separator::after) {
        background: var(
            --vscode-positronActionBar-separator,
            var(--positron-action-bar-border)
        );
    }

    .console-action-bar :global(.action-bar-button.interrupt .codicon) {
        color: var(--vscode-errorForeground);
    }

    .state-label {
        color: var(--console-action-bar-foreground);
        font-size: 12px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
