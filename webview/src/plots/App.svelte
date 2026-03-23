<script lang="ts">
    /**
     * Plots App.svelte - Multi-Session Plots Panel
     * Displays plots with per-session state tracking.
     * Follows Positron's pattern of maintaining separate state per session.
     */
    import { onMount, tick } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import ActionBar from "./ActionBar.svelte";
    import PlotsContainer from "./PlotsContainer.svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import {
        ZoomLevel,
        DarkFilter,
        HistoryPolicy,
        HistoryPosition,
        type EditorTarget,
    } from "./types";
    import CustomSizeDialog from "./CustomSizeDialog.svelte";

    interface Plot {
        id: string;
        sessionId?: string; // Session that created this plot
        thumbnail?: string;
        cachedThumbnail?: string;
        renderVersion?: number;
        /** Initial image data to display without a render request */
        initialData?: string;
        initialRenderSettings?: {
            width: number;
            height: number;
            pixelRatio: number;
        };
        kind?: "static" | "dynamic" | "html";
        htmlUri?: string;
        originUri?: string;
        name?: string;
        code?: string;
        parentId?: string;
        languageId?: string;
        zoomLevel?: ZoomLevel;
        sizingPolicyId?: string;
        customSize?: { width: number; height: number };
        hasIntrinsicSize?: boolean;
    }

    interface SizingPolicyInfo {
        id: string;
        name: string;
    }

    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        state:
            | "uninitialized"
            | "starting"
            | "ready"
            | "busy"
            | "offline"
            | "interrupting"
            | "restarting"
            | "exiting"
            | "exited"
            | "disconnected";
    }

    interface PlotsListResult {
        plots: Plot[];
        selectedPlotId?: string;
        totalCount?: number;
        nextCursor?: number;
        hasMore?: boolean;
    }

    type PlotPatch = Partial<Omit<Plot, "id">>;

    interface PlotAddedParams {
        plotId: string;
        thumbnail?: string;
        initialData?: string;
        initialRenderSettings?: {
            width: number;
            height: number;
            pixelRatio: number;
        };
        renderVersion?: number;
        sessionId?: string;
        kind?: "static" | "dynamic" | "html";
        htmlUri?: string;
        originUri?: string;
        name?: string;
        code?: string;
        parentId?: string;
        languageId?: string;
        zoomLevel?: number;
        sizingPolicyId?: string;
        customSize?: { width: number; height: number };
        hasIntrinsicSize?: boolean;
    }

    interface SelectedPlotChangedParams {
        plotId?: string;
        selectedSizingPolicyId?: string;
        sizingPolicies?: SizingPolicyInfo[];
        customSize?: { width: number; height: number };
        hasIntrinsicSize?: boolean;
        zoomLevel?: number;
    }

    interface PlotRenderCompletedParams {
        plotId: string;
        uri?: string;
        renderVersion: number;
    }

    type PlotDisplayMode = "all" | "active";
    const HISTORY_LOAD_THRESHOLD_PX = 80;
    const HISTORY_PAGE_FALLBACK_SIZE = 16;
    const HISTORY_PAGE_MIN_SIZE = 8;
    const HISTORY_PAGE_MAX_SIZE = 64;
    const HISTORY_PAGE_OVERSCAN = 2;
    const HISTORY_ITEM_DEFAULT_WIDTH = 100;
    const HISTORY_ITEM_DEFAULT_HEIGHT = 74;

    // Multi-session state
    let sessions = $state<SessionInfo[]>([]);
    let activeSessionId = $state<string | undefined>();

    // All plots (from all sessions)
    let allPlots = $state<Plot[]>([]);
    let selectedPlotId = $state<string | null>(null);
    let lastSelectedPlotId: string | null = null;
    let plotDisplayMode = $state<PlotDisplayMode>("all");
    let connection = $state<MessageConnection | undefined>();
    let darkFilterMode = $state<DarkFilter>(DarkFilter.Auto);
    let historyPolicy = $state<HistoryPolicy>(HistoryPolicy.Automatic);
    let historyPosition = $state<HistoryPosition>(HistoryPosition.Auto);
    let openInEditorDefaultTarget = $state<EditorTarget>("activeGroup");
    let plotsListCursor = $state(0);
    let totalPlotsCount = $state<number | undefined>(undefined);
    let hasMorePlotsHistory = $state(false);
    let loadingOlderPlots = $state(false);

    // Sizing policy state (Positron integration)
    let sizingPolicies = $state<SizingPolicyInfo[]>([
        { id: "auto", name: "Auto" },
        { id: "square", name: "Square" },
        { id: "landscape", name: "Landscape" },
        { id: "portrait", name: "Portrait" },
        { id: "fill", name: "Fill" },
        { id: "intrinsic", name: "Intrinsic" },
    ]);
    let showCustomSizeDialog = $state(false);

    // Container dimensions for responsive layout
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let containerElement = $state<HTMLDivElement | undefined>(undefined);
    let plotViewportElement = $state<HTMLDivElement | undefined>(undefined);

    // Derived: filter plots by active session (show all if no session filter)
    const plots = $derived(
        plotDisplayMode === "active" && activeSessionId
            ? allPlots.filter((p) => p.sessionId === activeSessionId)
            : allPlots,
    );
    // Compute history position based on aspect ratio and user setting
    // - Auto: use aspect ratio to decide (bottom if tall, right if wide)
    // - Bottom: always show at bottom
    // - Right: always show on right
    const historyBottom = $derived(
        historyPosition === HistoryPosition.Bottom
            ? true
            : historyPosition === HistoryPosition.Right
              ? false
              : containerHeight / containerWidth > 0.75,
    );

    // Compute current index
    const currentIndex = $derived(
        selectedPlotId ? plots.findIndex((p) => p.id === selectedPlotId) : -1,
    );
    const selectedPlot = $derived(
        selectedPlotId
            ? (plots.find((p) => p.id === selectedPlotId) ??
                  plots[plots.length - 1])
            : plots[plots.length - 1],
    );

    const selectedPlotSessionName = $derived(
        selectedPlot?.sessionId
            ? (sessions.find((session) => session.id === selectedPlot.sessionId)
                  ?.name ?? selectedPlot.sessionId)
            : undefined,
    );

    const selectedPlotName = $derived(selectedPlot?.name);
    const selectedOriginUri = $derived(selectedPlot?.originUri);
    const selectedOriginFile = $derived.by(() => {
        if (!selectedOriginUri) {
            return undefined;
        }

        try {
            const pathname = new URL(selectedOriginUri).pathname;
            const segments = decodeURIComponent(pathname)
                .split("/")
                .filter(Boolean);
            return segments[segments.length - 1];
        } catch {
            return undefined;
        }
    });

    const selectedPlotZoomLevel = $derived(
        selectedPlot?.zoomLevel ?? ZoomLevel.Fit,
    );

    const selectedPlotSizingPolicyId = $derived(
        selectedPlot?.sizingPolicyId ?? "auto",
    );

    const selectedPlotCustomSize = $derived(selectedPlot?.customSize);

    const selectedPlotHasIntrinsicSize = $derived(
        selectedPlot?.hasIntrinsicSize ?? false,
    );

    // Show history based on history policy:
    // - AlwaysVisible: always show when plots exist
    // - NeverVisible: never show
    // - Automatic: show when there are 2+ plots and enough space
    const hasHistoryViewportSpace = $derived(
        containerWidth >= 300 && containerHeight >= 300,
    );
    const showHistory = $derived(
        historyPolicy === HistoryPolicy.NeverVisible
            ? false
            : historyPolicy === HistoryPolicy.AlwaysVisible
              ? plots.length > 0
              : plots.length >= 2 && hasHistoryViewportSpace,
    );

    // Reference to history scroller for keyboard navigation
    let historyScrollerElement = $state<HTMLDivElement | undefined>(undefined);
    let resizeObserver: ResizeObserver | undefined;
    let viewportObserver: ResizeObserver | undefined;
    let viewportUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastViewportKey = "";
    const isGalleryEditor = Boolean(
        (window as Window & { __ARK_PLOTS_GALLERY_EDITOR__?: boolean })
            .__ARK_PLOTS_GALLERY_EDITOR__,
    );

    async function handleWindowKeyDown(event: KeyboardEvent) {
        if (!isGalleryEditor) {
            return;
        }

        const isCloseShortcut =
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === "w";
        if (!isCloseShortcut) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (!connection) {
            return;
        }

        try {
            await connection.sendRequest("plots/closeAuxPanel");
        } catch (e) {
            console.error("Failed to close gallery auxiliary panel:", e);
        }
    }

    function clonePlotSize(
        size: Plot["customSize"],
    ): Plot["customSize"] | undefined {
        if (!size) {
            return undefined;
        }

        return {
            width: size.width,
            height: size.height,
        };
    }

    function setSelectedPlotId(
        nextPlotId: string | null,
        options?: { preventServerEcho?: boolean },
    ): void {
        if (options?.preventServerEcho) {
            // Update lastSelectedPlotId first to prevent the $effect from
            // sending a duplicate select request back to the server.
            lastSelectedPlotId = nextPlotId;
        }
        selectedPlotId = nextPlotId;
    }

    function patchPlot(
        plotId: string,
        patch: PlotPatch | ((plot: Plot) => Plot),
    ): void {
        let changed = false;
        const nextPlots = allPlots.map((plot) => {
            if (plot.id !== plotId) {
                return plot;
            }

            const nextPlot =
                typeof patch === "function"
                    ? patch(plot)
                    : { ...plot, ...patch };

            changed ||= nextPlot !== plot;
            return nextPlot;
        });

        if (changed) {
            allPlots = nextPlots;
        }
    }

    function upsertPlotFromAdded(params: PlotAddedParams): void {
        const existing = allPlots.find((plot) => plot.id === params.plotId);
        const isNewPlot = !existing;
        const isStaleRender =
            typeof params.renderVersion === "number" &&
            existing &&
            params.renderVersion < (existing.renderVersion ?? 0);

        allPlots = [
            ...allPlots.filter((plot) => plot.id !== params.plotId),
            normalizePlot({
                id: params.plotId,
                sessionId: params.sessionId,
                thumbnail: isStaleRender
                    ? existing.thumbnail
                    : (params.thumbnail ?? existing?.thumbnail),
                cachedThumbnail: isStaleRender
                    ? existing.cachedThumbnail
                    : (params.thumbnail ??
                      existing?.cachedThumbnail ??
                      existing?.thumbnail),
                renderVersion: isStaleRender
                    ? existing.renderVersion ?? 0
                    : params.renderVersion ?? existing?.renderVersion,
                initialData: params.initialData ?? existing?.initialData,
                initialRenderSettings:
                    params.initialRenderSettings ??
                    existing?.initialRenderSettings,
                kind: params.kind ?? existing?.kind,
                htmlUri: params.htmlUri ?? existing?.htmlUri,
                originUri: params.originUri ?? existing?.originUri,
                name: params.name ?? existing?.name,
                code: params.code ?? existing?.code,
                parentId: params.parentId ?? existing?.parentId,
                languageId: params.languageId ?? existing?.languageId,
                zoomLevel:
                    (params.zoomLevel as ZoomLevel | undefined) ??
                    existing?.zoomLevel,
                sizingPolicyId:
                    params.sizingPolicyId ?? existing?.sizingPolicyId,
                customSize:
                    clonePlotSize(params.customSize) ??
                    clonePlotSize(existing?.customSize),
                hasIntrinsicSize:
                    params.hasIntrinsicSize ?? existing?.hasIntrinsicSize,
            }),
        ];

        if (!isNewPlot) {
            return;
        }

        plotsListCursor += 1;
        if (typeof totalPlotsCount === "number") {
            totalPlotsCount += 1;
            hasMorePlotsHistory = plotsListCursor < totalPlotsCount;
        }

        // Only auto-select genuinely new plots, not updates to existing ones.
        setSelectedPlotId(params.plotId);
    }

    function removePlots(plotIds: string[]): void {
        if (plotIds.length === 0) {
            return;
        }

        const removedIds = new Set(plotIds);
        const beforeLoadedCount = allPlots.length;
        allPlots = allPlots.filter((plot) => !removedIds.has(plot.id));

        const removedLoadedCount = beforeLoadedCount - allPlots.length;
        if (removedLoadedCount > 0) {
            plotsListCursor = Math.max(0, plotsListCursor - removedLoadedCount);
        }
        if (typeof totalPlotsCount === "number") {
            totalPlotsCount = Math.max(0, totalPlotsCount - plotIds.length);
            hasMorePlotsHistory = plotsListCursor < totalPlotsCount;
        }

        if (selectedPlotId && removedIds.has(selectedPlotId)) {
            setSelectedPlotId(
                allPlots.length > 0 ? allPlots[allPlots.length - 1].id : null,
            );
        }
    }

    function clearPlotsState(): void {
        allPlots = [];
        setSelectedPlotId(null);
        plotsListCursor = 0;
        totalPlotsCount = 0;
        hasMorePlotsHistory = false;
        loadingOlderPlots = false;
    }

    function applyRenderCompleted(params: PlotRenderCompletedParams): void {
        const existing = allPlots.find((plot) => plot.id === params.plotId);
        if (
            existing &&
            typeof existing.renderVersion === "number" &&
            params.renderVersion < (existing.renderVersion ?? 0)
        ) {
            return;
        }

        if (params.uri) {
            if (
                existing &&
                existing.thumbnail === params.uri &&
                existing.cachedThumbnail === params.uri &&
                params.renderVersion === existing.renderVersion
            ) {
                return;
            }

            patchPlot(params.plotId, {
                thumbnail: params.uri,
                cachedThumbnail: params.uri,
                renderVersion: params.renderVersion,
            });
            return;
        }

        patchPlot(params.plotId, (plot) => ({
            ...plot,
            renderVersion: Math.max(
                plot.renderVersion ?? 0,
                params.renderVersion,
            ),
        }));
    }

    function applyPlotsPage(result: PlotsListResult): void {
        const normalized = (result.plots ?? []).map((plot) =>
            normalizePlot(plot),
        );

        allPlots = normalized;
        plotsListCursor =
            result.nextCursor !== undefined
                ? result.nextCursor
                : normalized.length;
        totalPlotsCount = result.totalCount;
        hasMorePlotsHistory = Boolean(result.hasMore);

        setSelectedPlotId(
            normalized.length > 0
                ? (result.selectedPlotId ?? normalized[normalized.length - 1].id)
                : null,
            { preventServerEcho: true },
        );
    }

    function updateSelectionFromNotification(
        params: SelectedPlotChangedParams,
    ): void {
        const nextPlotId = params.plotId ?? null;
        if (nextPlotId !== selectedPlotId) {
            setSelectedPlotId(nextPlotId, { preventServerEcho: true });
        }

        if (params.sizingPolicies) {
            sizingPolicies = params.sizingPolicies;
        }

        if (!nextPlotId) {
            return;
        }

        const nextPatch: PlotPatch = {};
        if (params.selectedSizingPolicyId) {
            nextPatch.sizingPolicyId = params.selectedSizingPolicyId;
        }
        if (params.customSize !== undefined) {
            nextPatch.customSize = clonePlotSize(params.customSize);
        }
        if (typeof params.hasIntrinsicSize === "boolean") {
            nextPatch.hasIntrinsicSize = params.hasIntrinsicSize;
        }
        if (typeof params.zoomLevel === "number") {
            nextPatch.zoomLevel = params.zoomLevel as ZoomLevel;
        }

        if (Object.keys(nextPatch).length > 0) {
            patchPlot(nextPlotId, nextPatch);
        }
    }

    function normalizePlot(plot: Plot): Plot {
        return {
            ...plot,
            renderVersion:
                typeof plot.renderVersion === "number" ? plot.renderVersion : 0,
            zoomLevel:
                typeof plot.zoomLevel === "number"
                    ? (plot.zoomLevel as ZoomLevel)
                    : ZoomLevel.Fit,
            sizingPolicyId: plot.sizingPolicyId,
            customSize: clonePlotSize(plot.customSize),
            hasIntrinsicSize: plot.hasIntrinsicSize,
        };
    }

    function mergeOlderPlots(olderPlots: Plot[]): void {
        if (olderPlots.length === 0) {
            return;
        }

        const existingIds = new Set(allPlots.map((plot) => plot.id));
        const deduped = olderPlots.filter((plot) => !existingIds.has(plot.id));
        if (deduped.length === 0) {
            return;
        }

        allPlots = [...deduped, ...allPlots];
    }

    function isHistoryNearStart(scroller: HTMLElement): boolean {
        if (historyBottom) {
            return scroller.scrollLeft <= HISTORY_LOAD_THRESHOLD_PX;
        }
        return scroller.scrollTop <= HISTORY_LOAD_THRESHOLD_PX;
    }

    function parseCssPx(value: string): number {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    function getHistoryPageSize(): number {
        const fallbackItemExtent = historyBottom
            ? HISTORY_ITEM_DEFAULT_WIDTH
            : HISTORY_ITEM_DEFAULT_HEIGHT;
        const fallbackViewportExtent = historyBottom
            ? Math.max(1, containerWidth)
            : Math.max(1, containerHeight);

        let itemExtent = fallbackItemExtent;
        let viewportExtent = fallbackViewportExtent;

        const scroller = historyScrollerElement;
        if (scroller) {
            const measuredViewportExtent = historyBottom
                ? scroller.clientWidth
                : scroller.clientHeight;
            if (measuredViewportExtent > 0) {
                viewportExtent = measuredViewportExtent;
            }

            const firstThumbnail = scroller.querySelector(
                ".plot-thumbnail",
            ) as HTMLElement | null;
            if (firstThumbnail) {
                const rect = firstThumbnail.getBoundingClientRect();
                const style = getComputedStyle(firstThumbnail);
                const marginStart = historyBottom
                    ? parseCssPx(style.marginLeft)
                    : parseCssPx(style.marginTop);
                const marginEnd = historyBottom
                    ? parseCssPx(style.marginRight)
                    : parseCssPx(style.marginBottom);
                const measuredItemExtent =
                    (historyBottom ? rect.width : rect.height) +
                    marginStart +
                    marginEnd;
                if (measuredItemExtent > 0) {
                    itemExtent = measuredItemExtent;
                }
            }
        }

        const visibleCount = Math.max(
            1,
            Math.ceil(viewportExtent / itemExtent),
        );
        const estimatedPageSize = Math.max(
            HISTORY_PAGE_FALLBACK_SIZE,
            visibleCount * HISTORY_PAGE_OVERSCAN,
        );
        return clamp(
            Math.ceil(estimatedPageSize),
            HISTORY_PAGE_MIN_SIZE,
            HISTORY_PAGE_MAX_SIZE,
        );
    }

    async function requestPlotsPage(
        cursor: number,
        limit: number,
    ): Promise<PlotsListResult | undefined> {
        if (!connection) {
            return undefined;
        }

        try {
            return (await connection.sendRequest("plots/list", {
                cursor,
                limit,
            })) as PlotsListResult;
        } catch (e) {
            console.error("Failed to list plots page:", e);
            return undefined;
        }
    }

    async function loadOlderPlotsPageIfNeeded(): Promise<void> {
        if (!connection || !hasMorePlotsHistory || loadingOlderPlots) {
            return;
        }

        const scroller = historyScrollerElement;
        if (scroller && !isHistoryNearStart(scroller)) {
            return;
        }

        loadingOlderPlots = true;

        const beforeExtent = scroller
            ? historyBottom
                ? scroller.scrollWidth
                : scroller.scrollHeight
            : 0;
        const beforeOffset = scroller
            ? historyBottom
                ? scroller.scrollLeft
                : scroller.scrollTop
            : 0;

        try {
            const page = await requestPlotsPage(
                plotsListCursor,
                getHistoryPageSize(),
            );
            if (!page) {
                return;
            }

            const normalized = (page.plots ?? []).map((plot) =>
                normalizePlot(plot),
            );
            mergeOlderPlots(normalized);

            plotsListCursor =
                page.nextCursor ?? plotsListCursor + normalized.length;
            hasMorePlotsHistory = Boolean(page.hasMore);
            if (typeof page.totalCount === "number") {
                totalPlotsCount = page.totalCount;
            }

            if (normalized.length > 0 && scroller) {
                await tick();
                const afterExtent = historyBottom
                    ? scroller.scrollWidth
                    : scroller.scrollHeight;
                const delta = Math.max(0, afterExtent - beforeExtent);
                if (historyBottom) {
                    scroller.scrollLeft = beforeOffset + delta;
                } else {
                    scroller.scrollTop = beforeOffset + delta;
                }
            }
        } finally {
            loadingOlderPlots = false;
        }
    }

    onMount(() => {
        connection = getRpcConnection();
        window.addEventListener("keydown", handleWindowKeyDown, true);

        // Listen for new plots with sessionId
        connection.onNotification(
            "plots/added",
            (params: PlotAddedParams) => {
                if (!params.sessionId) {
                    console.warn("[Plots] Dropping plot without sessionId");
                    return;
                }
                upsertPlotFromAdded(params);
            },
        );

        // Listen for plots cleared
        connection.onNotification("plots/cleared", () => {
            clearPlotsState();
        });

        // Listen for plots removed (session-specific cleanup)
        connection.onNotification(
            "plots/removed",
            (params: { plotIds: string[]; sessionId: string }) => {
                removePlots(params.plotIds);
            },
        );

        // Listen for session info updates
        connection.onNotification(
            "session/info",
            (params: { sessions: SessionInfo[]; activeSessionId?: string }) => {
                sessions = params.sessions;
                activeSessionId = resolveActiveSessionId(
                    params.sessions,
                    params.activeSessionId,
                    activeSessionId,
                );
            },
        );

        // Fetch initial plots/history state (session state is push-based via session/info).
        (async () => {
            try {
                const historyState = (await connection!.sendRequest(
                    "plots/getHistoryState",
                )) as {
                    policy?: HistoryPolicy;
                    position?: HistoryPosition;
                };
                if (historyState.policy) {
                    historyPolicy = historyState.policy;
                }
                if (historyState.position) {
                    historyPosition = historyState.position;
                }
            } catch (e) {
                console.error("Failed to get history state:", e);
            }

            try {
                const darkFilterState = (await connection!.sendRequest(
                    "plots/getDarkFilterMode",
                )) as { mode?: DarkFilter };
                if (darkFilterState.mode) {
                    darkFilterMode = darkFilterState.mode;
                }
            } catch (e) {
                console.error("Failed to get dark filter mode:", e);
            }

            try {
                const editorTargetState = (await connection!.sendRequest(
                    "plots/getPreferredEditorTarget",
                )) as { target?: EditorTarget };
                if (editorTargetState.target) {
                    openInEditorDefaultTarget = editorTargetState.target;
                }
            } catch (e) {
                console.error("Failed to get preferred editor target:", e);
            }

            // Load plots.
            try {
                const result = await requestPlotsPage(0, getHistoryPageSize());
                if (result) {
                    applyPlotsPage(result);
                }
            } catch (e) {
                console.error("Failed to list plots:", e);
            }

            try {
                await tick();
                scrollSelectedThumbnailIntoView({ behavior: "auto" });
            } catch (e) {
                console.error("Failed to position history scroller:", e);
            }
        })();

        // Setup resize observer
        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                containerWidth = entry.contentRect.width;
                containerHeight = entry.contentRect.height;
            }
        });

        if (containerElement) {
            resizeObserver.observe(containerElement);
            containerWidth = containerElement.clientWidth;
            containerHeight = containerElement.clientHeight;
        }

        // Listen for sizing policy changes
        connection.onNotification(
            "plots/sizingPolicyChanged",
            (params: {
                plotId?: string;
                policyId: string;
                policies?: SizingPolicyInfo[];
                customSize?: { width: number; height: number };
            }) => {
                if (params.policies) {
                    sizingPolicies = params.policies;
                }

                const targetPlotId =
                    params.plotId ?? selectedPlotId ?? undefined;
                if (targetPlotId) {
                    patchPlot(targetPlotId, {
                        sizingPolicyId: params.policyId,
                        customSize: clonePlotSize(params.customSize),
                    });
                }
            },
        );

        connection.onNotification(
            "plots/selectedChanged",
            (params: SelectedPlotChangedParams) => {
                updateSelectionFromNotification(params);
            },
        );

        connection.onNotification(
            "plots/zoomChanged",
            (params: { plotId: string; zoomLevel: number }) => {
                if (typeof params.zoomLevel !== "number") {
                    return;
                }

                patchPlot(params.plotId, {
                    zoomLevel: params.zoomLevel as ZoomLevel,
                });
            },
        );

        connection.sendNotification("plots/ready");

        // Listen for history policy changes
        connection.onNotification(
            "plots/historyPolicyChanged",
            (params: { policy: HistoryPolicy }) => {
                historyPolicy = params.policy;
            },
        );

        connection.onNotification(
            "plots/historyPositionChanged",
            (params: { position: HistoryPosition }) => {
                historyPosition = params.position;
            },
        );

        connection.onNotification(
            "plots/darkFilterModeChanged",
            (params: { mode: DarkFilter }) => {
                darkFilterMode = params.mode;
            },
        );

        connection.onNotification(
            "plots/updated",
            (params: {
                plotId: string;
                name?: string;
                code?: string;
                parentId?: string;
                languageId?: string;
                originUri?: string;
            }) => {
                patchPlot(params.plotId, (plot) => ({
                    ...plot,
                    name: params.name ?? plot.name,
                    code: params.code ?? plot.code,
                    parentId: params.parentId ?? plot.parentId,
                    languageId: params.languageId ?? plot.languageId,
                    originUri: params.originUri ?? plot.originUri,
                }));
            },
        );

        // Listen for plot state changes
        connection.onNotification(
            "plots/plotStateChanged",
            (params: { plotId: string; state: string }) => {
                // Could update plot state tracking here
                console.log(`Plot ${params.plotId} state: ${params.state}`);
            },
        );

        // Listen for render completion and keep thumbnail list in sync.
        connection.onNotification(
            "plots/renderCompleted",
            (params: {
                plotId: string;
                uri?: string;
                renderTimeMs: number;
                renderVersion: number;
            }) => {
                applyRenderCompleted(params);
                // console.log(
                //     `Plot ${params.plotId} rendered in ${params.renderTimeMs}ms`,
                // );
            },
        );

        // Track plot viewport size for pre-render settings.
        viewportObserver = new ResizeObserver(() => {
            scheduleViewportUpdate();
        });

        if (plotViewportElement) {
            viewportObserver.observe(plotViewportElement);
            scheduleViewportUpdate();
        }

        return () => {
            window.removeEventListener("keydown", handleWindowKeyDown, true);
            resizeObserver?.disconnect();
            viewportObserver?.disconnect();
            if (viewportUpdateTimeout) {
                clearTimeout(viewportUpdateTimeout);
            }
        };
    });

    function resolveActiveSessionId(
        availableSessions: SessionInfo[],
        requestedSessionId?: string,
        currentSessionId?: string,
    ): string | undefined {
        if (requestedSessionId) {
            const requestedSession = availableSessions.find(
                (session) => session.id === requestedSessionId,
            );
            if (requestedSession) {
                return requestedSession.id;
            }
        }

        if (currentSessionId) {
            const currentSession = availableSessions.find(
                (session) => session.id === currentSessionId,
            );
            if (currentSession) {
                return currentSession.id;
            }
        }

        return availableSessions[0]?.id;
    }

    // Navigation
    function handlePrevious() {
        if (currentIndex > 0) {
            setSelectedPlotId(plots[currentIndex - 1].id);
        }
    }

    function handleNext() {
        if (currentIndex < plots.length - 1) {
            setSelectedPlotId(plots[currentIndex + 1].id);
        }
    }

    // Plot actions
    async function handleSave() {
        if (!connection || !selectedPlotId) return;
        if (selectedPlot?.kind === "html") {
            console.warn("Save not supported for HTML plots");
            return;
        }
        try {
            await connection.sendRequest("plots/save", {
                plotId: selectedPlotId,
            });
        } catch (e) {
            console.error("Failed to save plot:", e);
        }
    }

    async function resolvePlotDataUri(): Promise<string | null> {
        if (selectedPlot?.kind === "html") {
            return null;
        }
        const imageElement = plotViewportElement?.querySelector(
            "img.plot",
        ) as HTMLImageElement | null;
        const src = imageElement?.getAttribute("src");
        if (src && src.startsWith("data:")) {
            return src;
        }

        if (!connection || !selectedPlotId) {
            return null;
        }

        try {
            const width = plotViewportElement?.clientWidth || 400;
            const height = plotViewportElement?.clientHeight || 400;
            const pixelRatio = window.devicePixelRatio || 1;
            const result = (await connection.sendRequest("plots/render", {
                plotId: selectedPlotId,
                width,
                height,
                format: "png",
                pixelRatio,
            })) as {
                data: string;
                mimeType: string;
                renderVersion: number;
            };

            if (!result.data) {
                return null;
            }

            return result.data.startsWith("data:")
                ? result.data
                : `data:${result.mimeType};base64,${result.data}`;
        } catch (e) {
            console.error("Failed to render plot for clipboard:", e);
            return null;
        }
    }

    function dataUriToBlob(dataUri: string): Blob | null {
        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
            return null;
        }
        const mime = match[1];
        const base64Data = match[2];
        const byteString = atob(base64Data);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    async function copyImageToClipboard(dataUri: string): Promise<boolean> {
        const clipboardItemCtor = (window as any).ClipboardItem as
            | {
                  new (items: Record<string, Blob>): any;
                  supports?: (type: string) => boolean;
              }
            | undefined;

        if (!navigator.clipboard || !clipboardItemCtor) {
            return false;
        }

        try {
            const blob = dataUriToBlob(dataUri);
            if (!blob) {
                throw new Error("Unsupported data URI format");
            }
            const mime = blob.type || "image/png";

            if (
                clipboardItemCtor.supports &&
                !clipboardItemCtor.supports(mime)
            ) {
                throw new Error(`Unsupported image format: ${mime}`);
            }

            await navigator.clipboard.write([
                new clipboardItemCtor({
                    [mime]: blob,
                }),
            ]);
            return true;
        } catch (e) {
            console.error("Failed to copy image to clipboard:", e);
            return false;
        }
    }

    async function handleCopy() {
        if (!selectedPlotId) return;
        if (selectedPlot?.kind === "html") {
            console.warn("Copy not supported for HTML plots");
            return;
        }
        const dataUri = await resolvePlotDataUri();
        if (dataUri && (await copyImageToClipboard(dataUri))) {
            return;
        }

        try {
            if (connection) {
                await connection.sendRequest("plots/copy", {
                    plotId: selectedPlotId,
                });
                return;
            }

            if (dataUri && navigator.clipboard) {
                await navigator.clipboard.writeText(dataUri);
            }
        } catch (e) {
            console.error("Failed to copy plot:", e);
        }
    }

    function handleZoomChange(event: CustomEvent<{ zoomLevel: ZoomLevel }>) {
        if (!selectedPlotId) {
            return;
        }

        const nextZoom = event.detail.zoomLevel;

        patchPlot(selectedPlotId, { zoomLevel: nextZoom });

        if (connection) {
            void connection.sendRequest("plots/selectZoom", {
                plotId: selectedPlotId,
                zoomLevel: nextZoom,
            });
        }
    }

    async function handleDarkFilterChange(
        event: CustomEvent<{ mode: DarkFilter }>,
    ) {
        darkFilterMode = event.detail.mode;

        if (!connection) {
            return;
        }

        try {
            await connection.sendRequest("plots/selectDarkFilterMode", {
                mode: event.detail.mode,
            });
        } catch (e) {
            console.error("Failed to update dark filter mode:", e);
        }
    }

    function handleDisplayModeChange(
        event: CustomEvent<{ mode: PlotDisplayMode }>,
    ) {
        plotDisplayMode = event.detail.mode;
    }

    // Sizing policy handlers (Positron integration)
    async function handleSelectSizingPolicy(
        event: CustomEvent<{ policyId: string }>,
    ) {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/selectSizingPolicy", {
                policyId: event.detail.policyId,
            });
        } catch (e) {
            console.error("Failed to select sizing policy:", e);
        }
    }

    function handleSetCustomSize() {
        showCustomSizeDialog = true;
    }

    async function handleCustomSizeSubmit(
        event: CustomEvent<{ width: number; height: number }>,
    ) {
        if (!connection) return;
        const { width, height } = event.detail;
        try {
            await connection.sendRequest("plots/setCustomSize", {
                width,
                height,
            });

            if (selectedPlotId) {
                patchPlot(selectedPlotId, {
                    sizingPolicyId: "custom",
                    customSize: { width, height },
                });
            }
        } catch (e) {
            console.error("Failed to set custom size:", e);
        }
    }

    async function handleOpenInEditor(
        event: CustomEvent<{
            target: "editorTab" | "editorTabSide" | "newWindow";
        }>,
    ) {
        if (!connection || !selectedPlotId) return;
        if (selectedPlot?.kind === "html") {
            console.warn("Open in editor not supported for HTML plots");
            return;
        }

        const previousTarget = openInEditorDefaultTarget;
        const nextTarget: EditorTarget =
            event.detail.target === "newWindow"
                ? "newWindow"
                : event.detail.target === "editorTabSide"
                  ? "sideGroup"
                  : "activeGroup";

        try {
            openInEditorDefaultTarget = nextTarget;
            if (event.detail.target === "newWindow") {
                await connection.sendRequest("plots/openInNewWindow", {
                    plotId: selectedPlotId,
                });
                return;
            }

            const viewColumn =
                event.detail.target === "editorTabSide" ? "beside" : "active";
            await connection.sendRequest("plots/openInEditor", {
                plotId: selectedPlotId,
                viewColumn,
            });
        } catch (e) {
            openInEditorDefaultTarget = previousTarget;
            console.error("Failed to open plot in editor:", e);
        }
    }

    async function handleOpenGalleryInNewWindow() {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/openGalleryInNewWindow");
        } catch (e) {
            console.error("Failed to open gallery in new window:", e);
        }
    }

    async function handlePopoutPlot() {
        if (!connection || !selectedPlotId) {
            return;
        }

        try {
            await connection.sendRequest("plots/openInNewWindow", {
                plotId: selectedPlotId,
            });
        } catch (e) {
            console.error("Failed to pop out plot:", e);
        }
    }

    async function handleRevealPlotCodeInConsole(
        event: CustomEvent<{ sessionId: string; executionId: string }>,
    ) {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/revealInConsole", event.detail);
        } catch (e) {
            console.error("Failed to reveal plot code in console:", e);
        }
    }

    async function handleRunPlotCodeAgain(
        event: CustomEvent<{
            code: string;
            sessionId: string;
            languageId: string;
        }>,
    ) {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/runCodeAgain", event.detail);
        } catch (e) {
            console.error("Failed to run plot code again:", e);
        }
    }

    async function handleNavigateToPlotSource(data: {
        sessionId: string;
        executionId?: string;
    }) {
        if (!connection) {
            return;
        }

        try {
            if (data.executionId) {
                await connection.sendRequest("plots/revealInConsole", data);
                return;
            }

            await connection.sendRequest("plots/activateConsoleSession", {
                sessionId: data.sessionId,
            });
        } catch (e) {
            console.error("Failed to navigate to plot source:", e);
        }
    }

    async function handleOpenOriginFile() {
        if (!connection || !selectedPlotId) {
            return;
        }

        try {
            await connection.sendRequest("plots/openOriginFile", {
                plotId: selectedPlotId,
            });
        } catch (e) {
            console.error("Failed to open plot origin file:", e);
        }
    }

    async function handleOpenDarkFilterSettings() {
        if (!connection) {
            return;
        }

        try {
            await connection.sendRequest("plots/openDarkFilterSettings");
        } catch (e) {
            console.error("Failed to open dark filter settings:", e);
        }
    }

    async function handleClaimHtmlPlot(payload: { plotId: string }) {
        if (!connection) {
            return;
        }

        try {
            await connection.sendRequest("plots/claimHtmlPlot", payload);
        } catch (e) {
            console.error("Failed to claim HTML plot lifecycle:", e);
        }
    }

    async function handleReleaseHtmlPlot(payload: { plotId: string }) {
        if (!connection) {
            return;
        }

        try {
            await connection.sendRequest("plots/releaseHtmlPlot", payload);
        } catch (e) {
            console.error("Failed to release HTML plot lifecycle:", e);
        }
    }

    function handleLayoutHtmlPlot(payload: {
        plotId: string;
        width: number;
        height: number;
    }) {
        if (!connection) {
            return;
        }

        connection.sendNotification("plots/layoutHtmlPlot", payload);
    }

    async function handleClearAll() {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/clear");
            clearPlotsState();
        } catch (e) {
            console.error("Failed to clear plots:", e);
        }
    }

    // Thumbnail interactions
    function handleSelectPlot(id: string) {
        setSelectedPlotId(id);
    }

    async function handleDeletePlot(id: string) {
        if (!connection) return;
        try {
            await connection.sendRequest("plots/delete", { plotId: id });
            removePlots([id]);
        } catch (e) {
            console.error("Failed to delete plot:", e);
        }
    }

    function handlePlotRendered(payload: {
        plotId: string;
        uri: string;
        renderVersion: number;
    }) {
        applyRenderCompleted(payload);
    }

    function handleFocusPrevious(currentId: string) {
        const index = plots.findIndex((p) => p.id === currentId);
        if (index > 0) {
            const prevId = plots[index - 1].id;
            setSelectedPlotId(prevId);
            // Focus the thumbnail button using DOM query
            setTimeout(() => {
                const button = historyScrollerElement?.querySelector(
                    `[data-plot-id="${prevId}"]`,
                ) as HTMLButtonElement;
                button?.focus();
            }, 0);
        }
    }

    function handleFocusNext(currentId: string) {
        const index = plots.findIndex((p) => p.id === currentId);
        if (index < plots.length - 1) {
            const nextId = plots[index + 1].id;
            setSelectedPlotId(nextId);
            // Focus the thumbnail button using DOM query
            setTimeout(() => {
                const button = historyScrollerElement?.querySelector(
                    `[data-plot-id="${nextId}"]`,
                ) as HTMLButtonElement;
                button?.focus();
            }, 0);
        }
    }

    // Container keyboard navigation
    function handleContainerKeydown(event: KeyboardEvent) {
        if (event.target !== containerElement) return;

        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            handlePrevious();
        } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            handleNext();
        }
    }

    // Wheel handler for horizontal scrolling in history
    function handleHistoryWheel(event: WheelEvent) {
        if (!historyBottom) return;
        if (event.deltaY !== 0) {
            event.preventDefault();
            const scroller = event.currentTarget as HTMLElement;
            scroller.scrollLeft += event.deltaY;
        }
        void loadOlderPlotsPageIfNeeded();
    }

    function scrollSelectedThumbnailIntoView(
        options?: { behavior?: ScrollBehavior },
    ) {
        const scroller = historyScrollerElement;
        if (!scroller || !showHistory) {
            return;
        }

        const selectedThumbnail = scroller.querySelector(
            ".plot-thumbnail.selected",
        ) as HTMLElement | null;

        if (selectedThumbnail) {
            selectedThumbnail.scrollIntoView({
                behavior: options?.behavior ?? "smooth",
                block: "nearest",
                inline: "nearest",
            });
            return;
        }

        if (historyBottom) {
            scroller.scrollLeft = scroller.scrollWidth;
        } else {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }

    function scheduleViewportUpdate() {
        if (viewportUpdateTimeout) {
            clearTimeout(viewportUpdateTimeout);
        }
        viewportUpdateTimeout = setTimeout(() => {
            sendViewportUpdate();
        }, 500);
    }

    function sendViewportUpdate() {
        if (!connection || !plotViewportElement) return;
        const width = plotViewportElement.clientWidth;
        const height = plotViewportElement.clientHeight;
        if (width <= 0 || height <= 0) return;
        const pixelRatio = window.devicePixelRatio || 1;
        const key = `${width}x${height}@${pixelRatio}-${selectedPlotSizingPolicyId}`;
        if (key === lastViewportKey) {
            return;
        }
        lastViewportKey = key;
        connection.sendNotification("plots/viewportChanged", {
            width,
            height,
            pixelRatio,
            format: "png",
        });
    }

    $effect(() => {
        void selectedPlotId;
        if (!connection) return;

        if (!selectedPlotId) {
            lastSelectedPlotId = null;
            return;
        }

        if (selectedPlotId === lastSelectedPlotId) {
            return;
        }
        lastSelectedPlotId = selectedPlotId;

        const plotId = selectedPlotId;
        void connection.sendRequest("plots/select", { plotId }).catch((e) => {
            console.error("Failed to select plot:", e);
        });
    });

    $effect(() => {
        void selectedPlotSizingPolicyId;
        if (!connection || !plotViewportElement) return;
        lastViewportKey = "";
        scheduleViewportUpdate();
    });

    $effect(() => {
        void plots;
        if (plots.length === 0) {
            setSelectedPlotId(null);
            return;
        }
        if (!selectedPlotId || !plots.some((p) => p.id === selectedPlotId)) {
            setSelectedPlotId(plots[plots.length - 1].id);
        }
    });

    $effect(() => {
        const scroller = historyScrollerElement;
        if (!scroller) {
            return;
        }

        const onScroll = () => {
            void loadOlderPlotsPageIfNeeded();
        };

        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            scroller.removeEventListener("scroll", onScroll);
        };
    });

    let lastThumbnailScrollKey = $state("");

    $effect(() => {
        const scroller = historyScrollerElement;
        const historyVisible = showHistory;
        const orientation = historyBottom ? "bottom" : "right";
        const plotId = selectedPlotId;

        if (!scroller || !historyVisible) {
            lastThumbnailScrollKey = "";
            return;
        }

        const scrollKey = `${plotId ?? "latest"}:${orientation}`;
        if (scrollKey === lastThumbnailScrollKey) {
            return;
        }
        lastThumbnailScrollKey = scrollKey;

        void tick().then(() => {
            if (historyScrollerElement !== scroller) {
                return;
            }
            scrollSelectedThumbnailIntoView();
        });
    });
</script>

<div class="positron-plots-container">
    <ActionBar
        plotCount={plots.length}
        {currentIndex}
        hasPlots={plots.length > 0}
        {openInEditorDefaultTarget}
        selectedPlotKind={selectedPlot?.kind}
        zoomLevel={selectedPlotZoomLevel}
        {darkFilterMode}
        sizingPolicies={sizingPolicies.map((p) => ({
            id: p.id,
            getName: () => p.name,
            getPlotSize: () => undefined,
        }))}
        selectedSizingPolicy={sizingPolicies.find(
            (p) => p.id === selectedPlotSizingPolicyId,
        )
            ? {
                  id: selectedPlotSizingPolicyId,
                  getName: () =>
                      sizingPolicies.find(
                          (p) => p.id === selectedPlotSizingPolicyId,
                      )?.name || "",
                  getPlotSize: () => undefined,
              }
            : undefined}
        customSize={selectedPlotCustomSize}
        hasIntrinsicSize={selectedPlotHasIntrinsicSize}
        selectedPlotCode={selectedPlot?.code}
        selectedPlotExecutionId={selectedPlot?.parentId}
        selectedPlotSessionId={selectedPlot?.sessionId}
        selectedPlotLanguageId={selectedPlot?.languageId}
        selectedPlotHasOriginFile={!!selectedOriginUri}
        on:previous={handlePrevious}
        on:next={handleNext}
        on:save={handleSave}
        on:copy={handleCopy}
        on:zoomChange={handleZoomChange}
        on:darkFilterChange={handleDarkFilterChange}
        on:openDarkFilterSettings={handleOpenDarkFilterSettings}
        on:selectSizingPolicy={handleSelectSizingPolicy}
        on:setCustomSize={handleSetCustomSize}
        on:openInEditor={handleOpenInEditor}
        on:popoutPlot={handlePopoutPlot}
        on:revealPlotCodeInConsole={handleRevealPlotCodeInConsole}
        on:runPlotCodeAgain={handleRunPlotCodeAgain}
        on:openSourceFile={handleOpenOriginFile}
        on:openGalleryInNewWindow={handleOpenGalleryInNewWindow}
        on:clearAll={handleClearAll}
        on:displayModeChange={handleDisplayModeChange}
    />
    <PlotsContainer
        bind:containerElement
        bind:plotViewportElement
        bind:historyScrollerElement
        {connection}
        {plots}
        {selectedPlotId}
        zoomLevel={selectedPlotZoomLevel}
        {darkFilterMode}
        sizingPolicyId={selectedPlotSizingPolicyId}
        selectedSessionName={selectedPlotSessionName}
        selectedOriginFile={selectedOriginFile}
        {selectedPlotName}
        {showHistory}
        {historyBottom}
        onselectPlot={handleSelectPlot}
        onremovePlot={handleDeletePlot}
        onfocusPrevious={handleFocusPrevious}
        onfocusNext={handleFocusNext}
        oncontainerKeydown={handleContainerKeydown}
        onhistoryWheel={handleHistoryWheel}
        onnavigateToSource={handleNavigateToPlotSource}
        onopenOriginFile={handleOpenOriginFile}
        onclaimHtmlPlot={handleClaimHtmlPlot}
        onreleaseHtmlPlot={handleReleaseHtmlPlot}
        onlayoutHtmlPlot={handleLayoutHtmlPlot}
        onplotRendered={handlePlotRendered}
    />
</div>

<CustomSizeDialog
    bind:show={showCustomSizeDialog}
    initialWidth={selectedPlotCustomSize?.width ?? 800}
    initialHeight={selectedPlotCustomSize?.height ?? 600}
    on:submit={handleCustomSizeSubmit}
/>

<style>
    .positron-plots-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground);
    }
</style>
