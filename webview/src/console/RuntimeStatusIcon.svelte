<!--
    RuntimeStatusIcon.svelte
    
    Displays runtime status with appropriate icon and color.
    Mirrors: positron/.../components/runtimeStatus.tsx
-->
<script lang="ts">
    export type RuntimeStatusType = "active" | "idle" | "disconnected";

    interface Props {
        status: RuntimeStatusType;
        size?: "small" | "medium" | "large";
    }

    let { status, size = "medium" }: Props = $props();

    // Map status to icon and color (Positron 1:1 replication)
    const statusConfig: Record<
        RuntimeStatusType,
        { icon: string; color: string; animate: boolean }
    > = {
        active: {
            icon: "codicon-positron-status-active",
            color: "var(--vscode-positronConsole-stateIconActive, #3a79b2)",
            animate: true,
        },
        idle: {
            icon: "codicon-positron-status-idle",
            color: "var(--vscode-positronConsole-stateIconIdle, #2eb77c)",
            animate: false,
        },
        disconnected: {
            icon: "codicon-positron-status-disconnected",
            color:
                "var(--vscode-positronConsole-stateIconDisconnected, #d93939)",
            animate: false,
        },
    };

    const config = $derived(statusConfig[status] || statusConfig.idle);
    const sizeClass = $derived(`size-${size}`);
</script>

<span
    class="runtime-status-icon {sizeClass}"
    class:animate-spin={config.animate}
    style="color: {config.color}"
    title={status.charAt(0).toUpperCase() + status.slice(1)}
>
    <span class="codicon {config.icon}"></span>
</span>

<style>
    .runtime-status-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .size-small .codicon {
        width: 15px;
        height: 15px;
        font-size: 15px;
        line-height: 15px;
    }

    .size-medium .codicon {
        width: 15px;
        height: 15px;
        font-size: 15px;
        line-height: 15px;
    }

    .size-large .codicon {
        width: 16px;
        height: 16px;
        font-size: 16px;
        line-height: 16px;
    }

    .animate-spin .codicon {
        animation: runtime-spin 1.5s linear infinite;
    }

    @keyframes runtime-spin {
        100% {
            transform: rotate(360deg);
        }
    }
</style>
