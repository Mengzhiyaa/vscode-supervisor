<!--
  A value that is still loading, or that the last data request could not deliver.
  Port of Positron's TableDataCellPlaceholder.
-->
<script lang="ts">
    import { localize } from '../nls';

    let { unavailable = false }: { unavailable?: boolean } = $props();
    const unavailableLabel = localize('positron.dataExplorer.cellUnavailable', 'Value unavailable');
</script>

<div class="table-data-cell-placeholder">
    {#if unavailable}
        <div
            aria-label={unavailableLabel}
            class="data-grid-unavailable-mark codicon codicon-ellipsis"
            role="img"
            title={unavailableLabel}
        ></div>
    {:else}
        <div aria-hidden="true" class="data-grid-loading-mark codicon codicon-ellipsis"></div>
    {/if}
</div>

<style>
    .table-data-cell-placeholder {
        opacity: 0;
        height: 100%;
        display: flex;
        align-items: center;
        line-height: normal;
        justify-content: center;
        animation: table-data-cell-placeholder-fade-in 250ms ease-in forwards;
    }

    .data-grid-loading-mark {
        animation: data-grid-loading-mark-pulse 1.5s ease-in-out infinite;
    }

    @keyframes table-data-cell-placeholder-fade-in {
        to {
            opacity: 1;
        }
    }

    @keyframes data-grid-loading-mark-pulse {
        0%,
        100% {
            opacity: 0.35;
        }
        50% {
            opacity: 1;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .table-data-cell-placeholder {
            opacity: 1;
            animation: none;
        }

        .data-grid-loading-mark {
            animation: none;
        }
    }
</style>
