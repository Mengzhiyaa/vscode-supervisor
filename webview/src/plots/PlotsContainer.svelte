<script lang="ts">
    /**
     * PlotsContainer component.
     * The main container for plot display + filmstrip history.
     * Structured to match Positron's PlotsContainer responsibilities.
     */

    import { onMount } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import DynamicPlotInstance from "./DynamicPlotInstance.svelte";
    import StaticPlotInstance from "./StaticPlotInstance.svelte";
    import WebviewPlotInstance from "./WebviewPlotInstance.svelte";
    import PlotGalleryThumbnail from "./PlotGalleryThumbnail.svelte";
    import DynamicPlotThumbnail from "./DynamicPlotThumbnail.svelte";
    import StaticPlotThumbnail from "./StaticPlotThumbnail.svelte";
    import WebviewPlotThumbnail from "./WebviewPlotThumbnail.svelte";
    import { ZoomLevel, DarkFilter } from "./types";

    interface PlotData {
        id: string;
        sessionId?: string;
        kind?: "static" | "dynamic" | "html";
        thumbnail?: string;
        cachedThumbnail?: string;
        renderVersion?: number;
        initialData?: string;
        initialRenderSettings?: {
            width: number;
            height: number;
            pixelRatio: number;
        };
        htmlUri?: string;
        name?: string;
        parentId?: string;
    }

    interface Props {
        connection: MessageConnection | undefined;
        plots: PlotData[];
        selectedPlotId: string | null;
        zoomLevel: ZoomLevel;
        darkFilterMode: DarkFilter;
        sizingPolicyId?: string;
        showHistory: boolean;
        historyBottom: boolean;
        selectedSessionName?: string;
        selectedPlotName?: string;
        selectedOriginFile?: string;

        onselectPlot?: (plotId: string) => void;
        onremovePlot?: (plotId: string) => void;
        onfocusPrevious?: (plotId: string) => void;
        onfocusNext?: (plotId: string) => void;
        oncontainerKeydown?: (event: KeyboardEvent) => void;
        onhistoryWheel?: (event: WheelEvent) => void;
        onnavigateToSource?: (payload: {
            sessionId: string;
            executionId?: string;
        }) => void;
        onopenOriginFile?: () => void;
        onclaimHtmlPlot?: (payload: { plotId: string }) => void;
        onreleaseHtmlPlot?: (payload: { plotId: string }) => void;
        onlayoutHtmlPlot?: (payload: {
            plotId: string;
            width: number;
            height: number;
        }) => void;
        onplotRendered?: (payload: {
            plotId: string;
            uri: string;
            renderVersion: number;
        }) => void;

        containerElement?: HTMLDivElement;
        plotViewportElement?: HTMLDivElement;
        historyScrollerElement?: HTMLDivElement;
    }

    let {
        connection,
        plots,
        selectedPlotId,
        zoomLevel,
        darkFilterMode,
        sizingPolicyId,
        showHistory,
        historyBottom,
        selectedSessionName,
        selectedPlotName,
        selectedOriginFile,
        onselectPlot,
        onremovePlot,
        onfocusPrevious,
        onfocusNext,
        oncontainerKeydown,
        onhistoryWheel,
        onnavigateToSource,
        onopenOriginFile,
        onclaimHtmlPlot,
        onreleaseHtmlPlot,
        onlayoutHtmlPlot,
        onplotRendered,
        containerElement = $bindable(),
        plotViewportElement = $bindable(),
        historyScrollerElement = $bindable(),
    }: Props = $props();

    const selectedPlot = $derived(
        selectedPlotId
            ? (plots.find((plot) => plot.id === selectedPlotId) ??
                  plots[plots.length - 1])
            : plots[plots.length - 1],
    );

    const plotInfoHeaderPx = 30;

    function handleSessionNameClick() {
        if (!selectedPlot?.sessionId) {
            return;
        }

        onnavigateToSource?.({
            sessionId: selectedPlot.sessionId,
            executionId: selectedPlot.parentId,
        });
    }

    function handleOriginFileClick() {
        if (!selectedOriginFile) {
            return;
        }

        onopenOriginFile?.();
    }

    let viewportWidth = $state(1);
    let viewportHeight = $state(1);

    function updateViewportSize() {
        if (!plotViewportElement) {
            return;
        }

        viewportWidth = Math.max(1, plotViewportElement.clientWidth);
        viewportHeight = Math.max(1, plotViewportElement.clientHeight);
    }

    onMount(() => {
        updateViewportSize();
    });

    $effect(() => {
        if (!plotViewportElement) {
            return;
        }

        updateViewportSize();

        const resizeObserver = new ResizeObserver(() => {
            updateViewportSize();
        });

        resizeObserver.observe(plotViewportElement);

        return () => {
            resizeObserver.disconnect();
        };
    });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    bind:this={containerElement}
    class="plots-container dark-filter-{darkFilterMode}"
    class:history-bottom={historyBottom}
    class:history-right={!historyBottom}
    tabindex="0"
    role="application"
    aria-label="Plot viewer"
    onkeydown={oncontainerKeydown}
>
    <div class="plot-content">
        {#if selectedPlot}
            <div class="plot-info-header" style="height: {plotInfoHeaderPx}px;">
                <span class="plot-info-text">
                    {#if selectedSessionName}
                        <button
                            class="plot-session-name"
                            onclick={handleSessionNameClick}
                            title="Reveal plot source in console"
                        >
                            {selectedSessionName}
                        </button>
                    {/if}
                    {#if selectedOriginFile}
                        <button
                            class="plot-origin-file"
                            type="button"
                            title={selectedOriginFile}
                            onclick={handleOriginFileClick}
                        >
                            <span class="codicon codicon-file"></span>
                            {selectedOriginFile}
                        </button>
                    {/if}
                    {#if selectedPlotName}
                        <span class="plot-name">{selectedPlotName}</span>
                    {/if}
                    {#if !selectedSessionName && !selectedPlotName && !selectedOriginFile}
                        <span>&nbsp;</span>
                    {/if}
                </span>
            </div>
        {/if}
        <div class="selected-plot" bind:this={plotViewportElement}>
            {#key selectedPlot?.id}
                {#if plots.length === 0}
                    <div class="plot-placeholder"></div>
                {:else if selectedPlot?.kind === "html" && selectedPlot.htmlUri}
                    <WebviewPlotInstance
                        plotId={selectedPlot.id}
                        width={viewportWidth}
                        height={viewportHeight}
                        htmlUri={selectedPlot.htmlUri}
                        onclaim={(payload) => onclaimHtmlPlot?.(payload)}
                        onrelease={(payload) => onreleaseHtmlPlot?.(payload)}
                        onlayout={(payload) => onlayoutHtmlPlot?.(payload)}
                    />
                {:else if selectedPlot?.kind === "static"}
                    <StaticPlotInstance
                        plotId={selectedPlot.id}
                        plotName={selectedPlot.name}
                        imageUri={selectedPlot.thumbnail ||
                            selectedPlot.initialData ||
                            ""}
                        zoom={zoomLevel}
                    />
                {:else if selectedPlot}
                    <DynamicPlotInstance
                        plotId={selectedPlot.id}
                        {connection}
                        width={viewportWidth}
                        height={viewportHeight}
                        zoom={zoomLevel}
                        {sizingPolicyId}
                        {darkFilterMode}
                        latestUri={selectedPlot.thumbnail ||
                            selectedPlot.cachedThumbnail}
                        renderVersion={selectedPlot.renderVersion}
                        initialData={selectedPlot.initialData}
                        initialRenderSettings={selectedPlot.initialRenderSettings}
                        onrendered={onplotRendered}
                    />
                {/if}
            {/key}
        </div>
    </div>

    {#if showHistory}
        <div
            bind:this={historyScrollerElement}
            class="plot-history-scroller"
            onwheel={onhistoryWheel}
        >
            <div class="plot-history">
                {#each plots as plot (plot.id)}
                    <PlotGalleryThumbnail
                        plotId={plot.id}
                        plotName={plot.name}
                        selected={selectedPlotId === plot.id}
                        onselect={onselectPlot}
                        onremove={onremovePlot}
                        {onfocusPrevious}
                        {onfocusNext}
                    >
                        {#snippet children()}
                            {#if plot.kind === "dynamic"}
                                <DynamicPlotThumbnail
                                    plotId={plot.id}
                                    plotName={plot.name}
                                    thumbnailUri={plot.thumbnail}
                                    cachedThumbnailUri={plot.cachedThumbnail}
                                />
                            {:else if plot.kind === "html"}
                                <WebviewPlotThumbnail
                                    plotId={plot.id}
                                    thumbnailUri={plot.thumbnail}
                                    cachedThumbnailUri={plot.cachedThumbnail}
                                />
                            {:else}
                                <StaticPlotThumbnail
                                    plotId={plot.id}
                                    plotName={plot.name}
                                    imageUri={plot.thumbnail ||
                                        plot.initialData ||
                                        ""}
                                />
                            {/if}
                        {/snippet}
                    </PlotGalleryThumbnail>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .plots-container {
        display: flex;
        flex: 1;
        overflow: hidden;
        background: var(--vscode-editor-background);
    }

    .plots-container:focus {
        outline: none;
    }

    .plots-container.history-right {
        flex-direction: row;
    }

    .plots-container.history-bottom {
        flex-direction: column;
    }

    .plot-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
    }

    .plot-info-header {
        display: flex;
        align-items: center;
        min-height: 30px;
        max-height: 30px;
        padding: 0 4px;
        background: var(--vscode-editor-background);
        overflow: hidden;
    }

    .plot-info-text {
        display: flex;
        align-items: center;
        width: 100%;
        white-space: nowrap;
        overflow: hidden;
    }

    .plot-session-name {
        font-size: 11px;
        color: var(--vscode-foreground);
        opacity: 0.8;
        padding: 3px 5px;
        border-radius: 5px;
        border: 1px solid var(--vscode-panel-border);
        margin-right: 4px;
        background: none;
        cursor: pointer;
    }

    .plot-session-name:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
    }

    .plot-origin-file {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        color: var(--vscode-foreground);
        opacity: 0.8;
        padding: 3px 5px;
        border-radius: 5px;
        border: 1px solid var(--vscode-panel-border);
        margin-right: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
        background: none;
        cursor: pointer;
    }

    .plot-origin-file:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
    }

    .plot-origin-file .codicon {
        font-size: 12px;
    }

    .plot-name {
        font-size: 12px;
        color: var(--vscode-foreground);
        opacity: 0.8;
        margin-left: auto;
        margin-right: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .selected-plot {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-height: 0;
        overflow: hidden;
    }

    .plot-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
    }

    .plot-history-scroller {
        overflow: auto;
        display: flex;
        align-items: center;
    }

    .plot-history {
        display: flex;
    }

    .history-right .plot-history-scroller {
        flex-direction: column;
        border-left: 1px solid var(--vscode-panel-border);
        width: 110px;
    }

    .history-right .plot-history {
        flex-direction: column;
        height: fit-content;
        margin-top: 10px;
        margin-bottom: 10px;
        padding-bottom: 10px;
    }

    .history-right .plot-history :global(.plot-thumbnail) {
        margin-top: 5px;
    }

    .history-bottom .plot-history-scroller {
        flex-direction: row;
        border-top: 1px solid var(--vscode-panel-border);
        height: 110px;
        min-width: 0;
    }

    .history-bottom .plot-history {
        flex-direction: row;
        width: fit-content;
        margin-right: 10px;
        margin-left: 10px;
        flex-shrink: 0;
    }

    .history-bottom .plot-history :global(.plot-thumbnail) {
        width: 100px;
        margin-left: 5px;
        margin-right: 5px;
    }
</style>
