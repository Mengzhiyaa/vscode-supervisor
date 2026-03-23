<!--
  StatusBarActivityIndicator.svelte - Activity indicator for data explorer status
  Port from Positron's statusBarActivityIndicator.tsx (Svelte 5 runes mode)
-->
<script lang="ts">
    import { getDataExplorerContext } from "../context";
    import { localize } from "../nls";

    type DataExplorerStatus = "idle" | "computing" | "disconnected" | "error";

    const context = getDataExplorerContext();
    const { stores } = context;
    const { status: statusStore } = stores;

    const status = $derived.by(
        () => ($statusStore ?? "idle") as DataExplorerStatus,
    );

    // Debounced status to avoid flickering
    let displayStatus = $state<DataExplorerStatus>("idle");
    let debounceTimeout: ReturnType<typeof setTimeout> | undefined;

    $effect(() => {
        const newStatus = status;

        if (displayStatus === "idle" && newStatus !== "idle") {
            displayStatus = newStatus;
        } else {
            if (debounceTimeout) clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                displayStatus = newStatus;
            }, 250);
        }

        return () => {
            if (debounceTimeout) clearTimeout(debounceTimeout);
        };
    });

    const statusText = $derived.by(() => {
        switch (displayStatus) {
            case "idle":
                return localize("positron.dataExplorer.idle", "Idle");
            case "computing":
                return localize("positron.dataExplorer.computing", "Computing");
            case "disconnected":
                return localize(
                    "positron.dataExplorer.disconnected",
                    "Disconnected",
                );
            case "error":
                return localize("positron.dataExplorer.error", "Error");
            default:
                return localize("positron.unknown", "Unknown");
        }
    });

    const statusClassName = $derived.by(() => {
        switch (displayStatus) {
            case "idle":
                return "idle";
            case "computing":
                return "computing";
            case "disconnected":
                return "disconnected";
            case "error":
                return "error";
            default:
                return "idle";
        }
    });
</script>

<div class="status-bar-indicator">
    <div
        aria-label={statusText}
        class={`icon ${statusClassName}`}
        title={statusText}
    ></div>
</div>

<style>
    .status-bar-indicator {
        padding: 0 2px;
        margin-right: 8px;
        height: 100%;
        display: flex;
        align-items: center;
        padding-left: 2px;
        border-right: 1px solid var(--vscode-positronDataExplorer-border);
    }

    .status-bar-indicator .action-bar-separator {
        margin-left: 4px;
    }

    .status-bar-indicator .icon {
        height: 20px;
        width: 20px;
    }

    .status-bar-indicator .icon.computing {
        background-image: url("./status-active.svg");
        animation: positronDataExplorerStatusBarActivityIndicator-rotate
            1.5s linear infinite;
    }

    @keyframes positronDataExplorerStatusBarActivityIndicator-rotate {
        to {
            transform: rotate(360deg);
        }
    }

    .status-bar-indicator .icon.idle {
        background-image: url("./status-idle.svg");
    }

    .status-bar-indicator .icon.disconnected {
        background-image: url("./status-disconnected.svg");
    }
</style>
