<script lang="ts">
    import { onMount, tick } from "svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { getRpcConnection } from "$lib/rpc/client";
    import { localize } from "$lib/localization";
    import ActionBars from "./ActionBars.svelte";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import VariableGroup from "./VariableGroup.svelte";
    import VariableItem from "./VariableItem.svelte";
    import VariableOverflow from "./VariableOverflow.svelte";
    import VariablesEmpty from "./VariablesEmpty.svelte";
    import {
        calculateVariablesColumnLayout,
        getNameColumnBounds,
    } from "./columnLayout";
    import { patchEntries } from "./patchEntries";
    import { calculateVirtualRange } from "./virtualList";
    import type { MemoryUsageSnapshot } from "../types/memory";
    import type {
        IVariableGroup,
        IVariableItem,
        VariableEntry,
        VariablesInstance,
        VariablesInstanceInfo,
        VariablesGrouping,
        VariablesSorting,
    } from "../types/variables";
    import {
        isVariableGroup,
        isVariableItem,
        isVariableOverflow,
    } from "../types/variables";

    type GroupingMode = VariablesGrouping;
    type SortingMode = VariablesSorting;

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

    interface SessionVariablesData {
        entries: VariableEntry[];
        revision: number;
        recentEntryIds: Set<string>;
        loaded: boolean;
        selectedEntryId: string | null;
        scrollOffset: number;
        nameColumnWidth: number;
    }

    const DEFAULT_NAME_COLUMN_WIDTH = 130;
    const MINIMUM_NAME_COLUMN_WIDTH = 100;
    const RIGHT_COLUMN_VISIBILITY_THRESHOLD = 250;
    const DEFAULT_GROUPING: GroupingMode = "kind";
    const DEFAULT_SORTING: SortingMode = "name";
    const DEFAULT_FILTER_TEXT = "";
    const DEFAULT_HIGHLIGHT_RECENT =
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const VARIABLE_ROW_HEIGHT = 26;
    const VIRTUAL_LIST_OVERSCAN = 10;
    const FILTER_DEBOUNCE_MS = 800;

    let sessions = $state<SessionInfo[]>([]);
    let activeSessionId = $state<string | undefined>();
    let activeVariablesInstanceId = $state<string | undefined>();
    const sessionDataMap = new SvelteMap<string, SessionVariablesData>();
    const variablesInstanceMap =
        new SvelteMap<string, VariablesInstanceInfo>();

    let loading = $state(true);
    let connection = $state<MessageConnection | undefined>();
    let selectedEntryId = $state<string | null>(null);
    let focused = $state(false);
    let variablesContainer = $state<HTMLDivElement | null>(null);
    let containerHeight = $state(0);
    let scrollTop = $state(0);
    let previousUiSessionId: string | undefined;
    let lastManualScrollTime = 0;

    let containerWidth = $state(0);
    let nameColumnWidth = $state(DEFAULT_NAME_COLUMN_WIDTH);
    let detailsColumnWidth = $state(0);
    let rightColumnVisible = $state(true);

    let groupingMode = $state<GroupingMode>(DEFAULT_GROUPING);
    let sortingMode = $state<SortingMode>(DEFAULT_SORTING);
    let filterText = $state(DEFAULT_FILTER_TEXT);
    let highlightRecent = $state(DEFAULT_HIGHLIGHT_RECENT);

    let contextMenuVisible = $state(false);
    let contextMenuPosition = $state({ x: 0, y: 0 });
    let contextMenuEntry = $state<VariableEntry | null>(null);
    let showDeleteAllDialog = $state(false);
    const viewerLoadingEntryIds = new SvelteSet<string>();
    let memoryUsageEnabled = $state(true);
    let memoryUsageSnapshot = $state<MemoryUsageSnapshot | undefined>();
    let showBusyProgress = $state(false);
    let filterTimer: ReturnType<typeof setTimeout> | undefined;
    let busyProgressTimer: ReturnType<typeof setTimeout> | undefined;
    let observedSettledInstance = false;
    const recentExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function getSessionData(sessionId: string): SessionVariablesData {
        return (
            sessionDataMap.get(sessionId) ?? {
                entries: [],
                revision: 0,
                recentEntryIds: new Set(),
                loaded: false,
                selectedEntryId: null,
                scrollOffset: 0,
                nameColumnWidth: DEFAULT_NAME_COLUMN_WIDTH,
            }
        );
    }

    function ensureSessionData(sessionId: string): SessionVariablesData {
        let data = sessionDataMap.get(sessionId);
        if (!data) {
            data = {
                entries: [],
                revision: 0,
                recentEntryIds: new Set(),
                loaded: false,
                selectedEntryId: null,
                scrollOffset: 0,
                nameColumnWidth: DEFAULT_NAME_COLUMN_WIDTH,
            };
            sessionDataMap.set(sessionId, data);
        }
        return data;
    }

    const currentEntries = $derived(
        activeSessionId ? getSessionData(activeSessionId).entries : [],
    );
    const currentRecentEntryIds = $derived(
        activeSessionId
            ? getSessionData(activeSessionId).recentEntryIds
            : new Set<string>(),
    );
    const activeVariablesInstance = $derived(
        activeVariablesInstanceId
            ? variablesInstanceMap.get(activeVariablesInstanceId)
            : activeSessionId
              ? variablesInstanceMap.get(activeSessionId)
              : undefined,
    );
    const activeInstanceDisabled = $derived(
        activeVariablesInstance?.state === "closed" ||
            activeVariablesInstance?.state === "closing",
    );
    const visibleRange = $derived(
        calculateVirtualRange(
            currentEntries.length,
            scrollTop,
            containerHeight,
            VARIABLE_ROW_HEIGHT,
            VIRTUAL_LIST_OVERSCAN,
        ),
    );
    const visibleStartIndex = $derived(visibleRange.start);
    const visibleEndIndex = $derived(visibleRange.end);
    const visibleEntries = $derived(
        currentEntries.slice(visibleStartIndex, visibleEndIndex),
    );
    const variablesInstances = $derived<VariablesInstance[]>(
        sessions
            .filter(
                (session) =>
                    variablesInstanceMap.size === 0 ||
                    variablesInstanceMap.has(session.id),
            )
            .map((session) => ({
                id: session.id,
                sessionName: session.name || session.runtimeName,
                runtimeName: session.runtimeName,
                state: variablesInstanceMap.get(session.id)?.state,
                status: variablesInstanceMap.get(session.id)?.status,
            })),
    );

    function syncActiveInstanceControls() {
        const instance =
            (activeVariablesInstanceId &&
                variablesInstanceMap.get(activeVariablesInstanceId)) ||
            (activeSessionId && variablesInstanceMap.get(activeSessionId)) ||
            undefined;

        groupingMode = instance?.grouping ?? DEFAULT_GROUPING;
        sortingMode = instance?.sorting ?? DEFAULT_SORTING;
        filterText = instance?.filterText ?? DEFAULT_FILTER_TEXT;
        highlightRecent =
            instance?.highlightRecent ?? DEFAULT_HIGHLIGHT_RECENT;
    }

    $effect(() => {
        if (containerWidth <= 0) return;
        const layout = calculateVariablesColumnLayout(
            containerWidth,
            nameColumnWidth,
            MINIMUM_NAME_COLUMN_WIDTH,
            RIGHT_COLUMN_VISIBILITY_THRESHOLD,
        );
        nameColumnWidth = layout.nameWidth;
        detailsColumnWidth = layout.detailsWidth;
        rightColumnVisible = layout.rightColumnVisible;
    });

    $effect(() => {
        const busy = !loading && activeVariablesInstance?.status === "busy";
        if (busyProgressTimer) {
            clearTimeout(busyProgressTimer);
            busyProgressTimer = undefined;
        }
        if (!busy) {
            showBusyProgress = false;
            if (activeVariablesInstance && activeVariablesInstance.status !== "busy") {
                observedSettledInstance = true;
            }
            return;
        }
        busyProgressTimer = setTimeout(() => {
            showBusyProgress = true;
            busyProgressTimer = undefined;
        }, observedSettledInstance ? 500 : 100);
        return () => {
            if (busyProgressTimer) {
                clearTimeout(busyProgressTimer);
                busyProgressTimer = undefined;
            }
        };
    });

    $effect(() => {
        const nextSessionId = activeSessionId;
        if (nextSessionId === previousUiSessionId) return;

        if (filterTimer) {
            clearTimeout(filterTimer);
            filterTimer = undefined;
        }

        previousUiSessionId = nextSessionId;
        if (!nextSessionId) {
            selectedEntryId = null;
            return;
        }

        restoreSessionUiState(nextSessionId);
    });

    $effect(() => {
        if (
            selectedEntryId &&
            !currentEntries.some((entry) => entry.id === selectedEntryId)
        ) {
            selectedEntryId = null;
        }
    });

    $effect(() => {
        void activeSessionId;
        void activeVariablesInstanceId;
        void variablesInstanceMap;
        syncActiveInstanceControls();
    });

    $effect(() => {
        connection?.sendNotification("variables/contextKeysChanged", {
            variablesFocused: focused,
            hasSelection: !!selectedEntryId && !activeInstanceDisabled,
        });
    });

    onMount(() => {
        const rpc = getRpcConnection();
        connection = rpc;

        rpc.onNotification(
            "variables/entriesChanged",
            (params: { sessionId: string; entries: VariableEntry[]; revision: number }) => {
                const data = ensureSessionData(params.sessionId);
                if (params.revision < (data.revision ?? 0)) {
                    return;
                }
                data.loaded = true;
                data.revision = params.revision;
                const { entries, changed } = patchEntries(
                    data.entries,
                    params.entries,
                );
                if (changed) {
                    data.entries = entries;
                    sessionDataMap.set(params.sessionId, { ...data });
                }
                applyRecentEntries(params.sessionId, params.entries);

                if (!activeSessionId) {
                    activeSessionId = params.sessionId;
                }
                if (params.sessionId === activeSessionId) {
                    loading = false;
                }
            },
        );

        rpc.onNotification(
            "session/info",
            (params: { sessions: SessionInfo[]; activeSessionId?: string }) => {
                const previousActiveSessionId = activeSessionId;
                for (const session of params.sessions) {
                    ensureSessionData(session.id);
                }
                sessions = params.sessions;

                const knownSessionIds = new Set(
                    params.sessions.map((session) => session.id),
                );
                for (const sessionId of Array.from(
                    variablesInstanceMap.keys(),
                )) {
                    if (!knownSessionIds.has(sessionId)) {
                        variablesInstanceMap.delete(sessionId);
                        sessionDataMap.delete(sessionId);
                        clearRecentTimersForSession(sessionId);
                    }
                }
                if (
                    activeVariablesInstanceId &&
                    !knownSessionIds.has(activeVariablesInstanceId)
                ) {
                    activeVariablesInstanceId = resolveActiveSessionId(
                        params.sessions.filter((session) =>
                            variablesInstanceMap.has(session.id),
                        ),
                    );
                }

                const nextActiveSessionId = resolveActiveSessionId(
                    params.sessions,
                    activeVariablesInstanceId ?? params.activeSessionId,
                    previousActiveSessionId,
                );
                if (nextActiveSessionId !== previousActiveSessionId) {
                    saveSessionUiState(previousActiveSessionId);
                }
                activeSessionId = nextActiveSessionId;
                if (activeSessionId && activeSessionId !== previousActiveSessionId) {
                    restoreSessionUiState(activeSessionId);
                }

                if (!activeSessionId) {
                    loading = false;
                    return;
                }

                if (!getSessionData(activeSessionId).loaded) {
                    void refreshEntries(activeSessionId);
                } else {
                    loading = false;
                }
            },
        );

        rpc.onNotification(
            "variables/instanceStarted",
            (params: { instance: VariablesInstanceInfo }) => {
                variablesInstanceMap.set(
                    params.instance.sessionId,
                    params.instance,
                );
            },
        );

        rpc.onNotification(
            "variables/instanceStopped",
            (params: { sessionId: string }) => {
                variablesInstanceMap.delete(params.sessionId);
                sessionDataMap.delete(params.sessionId);
                clearRecentTimersForSession(params.sessionId);

                if (activeVariablesInstanceId === params.sessionId) {
                    const availableInstanceSessions = sessions.filter((session) =>
                        variablesInstanceMap.has(session.id),
                    );
                    activeVariablesInstanceId = resolveActiveSessionId(
                        availableInstanceSessions,
                        undefined,
                    );
                }
            },
        );

        rpc.onNotification(
            "variables/activeInstanceChanged",
            (params: { sessionId?: string }) => {
                const previousActiveSessionId = activeSessionId;
                activeVariablesInstanceId = params.sessionId;
                const nextActiveSessionId = resolveActiveSessionId(
                    sessions,
                    params.sessionId,
                    activeSessionId,
                );
                if (nextActiveSessionId !== previousActiveSessionId) {
                    saveSessionUiState(previousActiveSessionId);
                }
                activeSessionId = nextActiveSessionId;
                if (activeSessionId && activeSessionId !== previousActiveSessionId) {
                    restoreSessionUiState(activeSessionId);
                }

                if (
                    activeSessionId &&
                    activeSessionId !== previousActiveSessionId
                ) {
                    if (!getSessionData(activeSessionId).loaded) {
                        void refreshEntries(activeSessionId);
                    } else {
                        loading = false;
                    }
                }
            },
        );

        rpc.onNotification(
            "variables/memoryUsageUpdated",
            (params: { snapshot: MemoryUsageSnapshot }) => {
                memoryUsageEnabled = true;
                memoryUsageSnapshot = params.snapshot;
            },
        );

        rpc.onNotification(
            "variables/memoryUsageEnabledChanged",
            (params: { enabled: boolean }) => {
                memoryUsageEnabled = params.enabled;
                if (!params.enabled) {
                    memoryUsageSnapshot = undefined;
                }
            },
        );

        rpc.onNotification(
            "variables/listCommand",
            (params: {
                command: "expand" | "collapse" | "copyAsText" | "copyAsHtml";
            }) => {
                const entry = getSelectedEntry();
                if (!entry || activeInstanceDisabled) return;
                switch (params.command) {
                    case "expand":
                        if (isVariableGroup(entry) && !entry.isExpanded) void toggleGroup(entry);
                        if (isVariableItem(entry) && entry.hasChildren && !entry.isExpanded) void toggleItem(entry);
                        break;
                    case "collapse":
                        if (isVariableGroup(entry) && entry.isExpanded) void toggleGroup(entry);
                        if (isVariableItem(entry) && entry.hasChildren && entry.isExpanded) void toggleItem(entry);
                        break;
                    case "copyAsText":
                        void copySelectedEntry(entry, "text/plain");
                        break;
                    case "copyAsHtml":
                        void copySelectedEntry(entry, "text/html");
                        break;
                }
            },
        );

        rpc.sendNotification("variables/ready");
        void rpc.sendRequest("variables/setReducedMotionPreference", {
            reduced: !DEFAULT_HIGHLIGHT_RECENT,
        });
        void hydrateMemoryUsage(rpc);

        return () => {
            if (filterTimer) clearTimeout(filterTimer);
            if (busyProgressTimer) clearTimeout(busyProgressTimer);
            for (const timer of recentExpiryTimers.values()) clearTimeout(timer);
            recentExpiryTimers.clear();
        };
    });

    function applyRecentEntries(sessionId: string, entries: VariableEntry[]) {
        const recentIds = entries.flatMap((entry) =>
            isVariableItem(entry) && entry.isRecent ? [entry.id] : [],
        );
        if (!recentIds.length) {
            return;
        }

        const data = ensureSessionData(sessionId);
        data.recentEntryIds = new Set([...data.recentEntryIds, ...recentIds]);
        sessionDataMap.set(sessionId, { ...data });

        for (const id of recentIds) {
            const timerKey = `${sessionId}\u0000${id}`;
            const existingTimer = recentExpiryTimers.get(timerKey);
            if (existingTimer) clearTimeout(existingTimer);
            recentExpiryTimers.set(
                timerKey,
                setTimeout(() => {
                    recentExpiryTimers.delete(timerKey);
                    const sessionData = sessionDataMap.get(sessionId);
                    if (!sessionData) return;
                    sessionData.recentEntryIds = new Set(
                        [...sessionData.recentEntryIds].filter((entryId) => entryId !== id),
                    );
                    sessionDataMap.set(sessionId, { ...sessionData });
                }, 2000),
            );
        }

        if (
            sessionId === activeSessionId &&
            highlightRecent &&
            Date.now() - lastManualScrollTime > 1000
        ) {
            void tick().then(() => scrollEntryIntoView(recentIds[0], "smooth"));
        }
    }

    function clearRecentTimersForSession(sessionId: string) {
        const prefix = `${sessionId}\u0000`;
        for (const [key, timer] of recentExpiryTimers) {
            if (!key.startsWith(prefix)) continue;
            clearTimeout(timer);
            recentExpiryTimers.delete(key);
        }
    }

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

    async function refreshEntries(sessionId?: string) {
        const targetSessionId = sessionId ?? activeSessionId;
        if (!connection || !targetSessionId) return;

        loading = true;
        try {
            const result = (await connection.sendRequest(
                "variables/listEntries",
                {
                    sessionId: targetSessionId,
                    knownRevision: ensureSessionData(targetSessionId).revision,
                },
            )) as { entries: VariableEntry[]; revision: number; unchanged: boolean };

            const data = ensureSessionData(targetSessionId);
            data.loaded = true;
            data.revision = result.revision;
            if (result.unchanged) {
                return;
            }
            const { entries, changed } = patchEntries(
                data.entries,
                result.entries,
            );
            if (changed) {
                data.entries = entries;
                sessionDataMap.set(targetSessionId, { ...data });
            }
            applyRecentEntries(targetSessionId, result.entries);
        } catch (error) {
            console.error("Failed to fetch variable entries:", error);
        } finally {
            loading = false;
        }
    }

    async function hydrateMemoryUsage(rpc: MessageConnection) {
        try {
            const state = (await rpc.sendRequest(
                "variables/getMemoryUsage",
            )) as {
                enabled: boolean;
                snapshot?: MemoryUsageSnapshot;
            };
            memoryUsageEnabled = state.enabled;
            memoryUsageSnapshot = state.enabled ? state.snapshot : undefined;
        } catch (error) {
            console.error("Failed to fetch memory usage:", error);
        }
    }

    async function refreshActiveSession() {
        if (!connection || !activeSessionId) return;

        try {
            await connection.sendRequest("variables/refresh", {
                sessionId: activeSessionId,
            });
        } catch (error) {
            console.error("Failed to refresh variables:", error);
        }
    }

    async function selectVariablesInstance(sessionId: string) {
        if (!connection || !sessionId || sessionId === activeSessionId) return;

        try {
            saveSessionUiState(activeSessionId);
            await connection.sendRequest("variables/setActiveSession", {
                sessionId,
            });
            activeVariablesInstanceId = sessionId;
            activeSessionId = sessionId;
            restoreSessionUiState(sessionId);
            if (!getSessionData(sessionId).loaded) {
                await refreshEntries(sessionId);
            } else {
                loading = false;
            }
        } catch (error) {
            console.error("Failed to select variables session:", error);
        }
    }

    function saveSessionUiState(sessionId?: string) {
        if (!sessionId) return;
        const data = ensureSessionData(sessionId);
        data.selectedEntryId = selectedEntryId;
        data.scrollOffset = scrollTop;
        data.nameColumnWidth = nameColumnWidth;
        sessionDataMap.set(sessionId, { ...data });
    }

    function restoreSessionUiState(sessionId: string) {
        const data = ensureSessionData(sessionId);
        selectedEntryId = data.selectedEntryId;
        nameColumnWidth = data.nameColumnWidth;
        scrollTop = data.scrollOffset;
        void tick().then(() => {
            if (variablesContainer && activeSessionId === sessionId) {
                variablesContainer.scrollTop = data.scrollOffset;
            }
        });
    }

    async function handleGroupingChange(grouping: GroupingMode) {
        groupingMode = grouping;
        if (!connection) return;

        try {
            await connection.sendRequest("variables/setGrouping", { grouping });
        } catch (error) {
            console.error("Failed to set variables grouping:", error);
        }
    }

    async function handleSortingChange(sorting: SortingMode) {
        sortingMode = sorting;
        if (!connection) return;

        try {
            await connection.sendRequest("variables/setSorting", { sorting });
        } catch (error) {
            console.error("Failed to set variables sorting:", error);
        }
    }

    function handleFilterChange(text: string) {
        filterText = text;
        if (filterTimer) {
            clearTimeout(filterTimer);
            filterTimer = undefined;
        }
        if (text === "") {
            void sendFilterText(text);
            return;
        }
        filterTimer = setTimeout(() => {
            filterTimer = undefined;
            void sendFilterText(text);
        }, FILTER_DEBOUNCE_MS);
    }

    async function sendFilterText(text: string) {
        if (!connection) return;

        try {
            await connection.sendRequest("variables/setFilter", {
                filterText: text,
            });
        } catch (error) {
            console.error("Failed to set variables filter:", error);
        }
    }

    async function handleHighlightRecentChange(value: boolean) {
        highlightRecent = value;
        if (!connection) return;

        try {
            await connection.sendRequest("variables/setHighlightRecent", {
                highlightRecent: value,
            });
        } catch (error) {
            console.error("Failed to set highlight recent:", error);
        }
    }

    function handleGroupSelect(entry: IVariableGroup) {
        if (activeInstanceDisabled) return;
        selectedEntryId = entry.id;
        persistSelection();
        variablesContainer?.focus();
    }

    function handleGroupContextMenu(
        entry: IVariableGroup,
        x: number,
        y: number,
    ) {
        selectedEntryId = entry.id;
        persistSelection();
        showContextMenu(entry, x, y);
    }

    async function toggleGroup(entry: IVariableGroup) {
        if (!connection || !activeSessionId || activeInstanceDisabled) return;

        try {
            await connection.sendRequest(
                entry.isExpanded
                    ? "variables/collapseGroup"
                    : "variables/expandGroup",
                {
                    groupId: entry.id,
                    sessionId: activeSessionId,
                },
            );
        } catch (error) {
            console.error("Failed to toggle variable group:", error);
        }
    }

    function findItemById(id: string): IVariableItem | undefined {
        const entry = currentEntries.find((e) => e.id === id);
        return entry && isVariableItem(entry) ? entry : undefined;
    }

    async function toggleItem(entry: IVariableItem) {
        if (!connection || !activeSessionId || !entry.hasChildren || activeInstanceDisabled) return;

        try {
            await connection.sendRequest(
                entry.isExpanded
                    ? "variables/collapseItem"
                    : "variables/expandItem",
                {
                    path: entry.path,
                    sessionId: activeSessionId,
                },
            );
        } catch (error) {
            console.error("Failed to toggle variable item:", error);
        }
    }

    function handleItemToggle(id: string) {
        const entry = findItemById(id);
        if (entry) void toggleItem(entry);
    }

    function handleItemSelect(id: string) {
        if (activeInstanceDisabled) return;
        selectedEntryId = id;
        persistSelection();
        variablesContainer?.focus();
    }

    function handleItemContextMenu(
        id: string,
        x: number,
        y: number,
    ) {
        const entry = findItemById(id);
        if (!entry) return;
        if (activeInstanceDisabled) {
            showContextMenu(entry, x, y);
            return;
        }
        selectedEntryId = id;
        persistSelection();
        showContextMenu(entry, x, y);
    }

    function handleItemView(id: string) {
        const entry = findItemById(id);
        if (entry) viewVariable(entry);
    }

    function handleOverflowSelect(entry: VariableEntry) {
        if (activeInstanceDisabled) return;
        selectedEntryId = entry.id;
        persistSelection();
        variablesContainer?.focus();
    }

    function selectEntry(entry: VariableEntry, index: number = -1) {
        if (activeInstanceDisabled) return;
        selectedEntryId = entry.id;
        persistSelection();
        scrollEntryIntoView(entry.id, "auto", index);
    }

    function clearSelection() {
        selectedEntryId = null;
        persistSelection();
    }

    function getSelectedEntry(): VariableEntry | undefined {
        if (!selectedEntryId) {
            return undefined;
        }

        return currentEntries.find((entry) => entry.id === selectedEntryId);
    }

    function showContextMenu(entry: VariableEntry, x: number, y: number) {
        contextMenuEntry = entry;
        contextMenuPosition = { x, y };
        contextMenuVisible = true;
    }

    function getContextMenuItems(entry: VariableEntry) {
        if (isVariableGroup(entry)) {
            return [
                {
                    id: entry.isExpanded ? "collapse-group" : "expand-group",
                    label: entry.isExpanded
                        ? localize("variables.collapse", "Collapse")
                        : localize("variables.expand", "Expand"),
                    icon: entry.isExpanded
                        ? "codicon-chevron-up"
                        : "codicon-chevron-down",
                },
            ];
        }

        if (!isVariableItem(entry)) {
            return [];
        }

        if (activeInstanceDisabled) {
            return [
                {
                    id: "copy-name",
                    label: localize("variables.copyName", "Copy Name"),
                    icon: "codicon-copy",
                },
            ];
        }

        const items: Array<{
            id: string;
            label: string;
            icon?: string;
            separator?: boolean;
            disabled?: boolean;
        }> = [];

        if (entry.hasViewer) {
            const isLoading = viewerLoadingEntryIds.has(entry.id);
            items.push({
                id: "view",
                label:
                    entry.kind === "table"
                          ? localize("variables.viewDataTable", "View Data Table")
                        : entry.kind === "connection"
                          ? localize("variables.viewConnection", "View Connection")
                          : localize("variables.view", "View"),
                icon: isLoading ? "codicon-loading" : "codicon-open-preview",
                disabled: isLoading,
            });
        }

        if (entry.hasChildren) {
            if (items.length > 0) {
                items.push({ id: "sep-expand", label: "", separator: true });
            }
            items.push({
                id: entry.isExpanded ? "collapse-item" : "expand-item",
                label: entry.isExpanded
                    ? localize("variables.collapse", "Collapse")
                    : localize("variables.expand", "Expand"),
                icon: entry.isExpanded
                    ? "codicon-chevron-up"
                    : "codicon-chevron-down",
            });
        }

        if (items.length > 0) {
            items.push({ id: "sep-copy", label: "", separator: true });
        }
        items.push({
            id: "copy-name",
            label: localize("variables.copyName", "Copy Name"),
            icon: "codicon-copy",
        });
        items.push({
            id: "copy-value",
            label: localize("variables.copyValue", "Copy Value"),
            icon: "codicon-copy",
        });
        items.push({ id: "sep-format", label: "", separator: true });
        items.push({ id: "copy-as-text", label: localize("variables.copyAsText", "Copy as Text") });
        items.push({ id: "copy-as-html", label: localize("variables.copyAsHtml", "Copy as HTML") });

        return items;
    }

    async function handleContextMenuSelect(actionId: string) {
        if (!contextMenuEntry) return;

        if (isVariableGroup(contextMenuEntry)) {
            if (
                actionId === "expand-group" ||
                actionId === "collapse-group"
            ) {
                await toggleGroup(contextMenuEntry);
            }
            return;
        }

        if (!isVariableItem(contextMenuEntry)) {
            return;
        }

        switch (actionId) {
            case "copy-name":
                await navigator.clipboard.writeText(contextMenuEntry.displayName);
                break;
            case "copy-value":
                await navigator.clipboard.writeText(
                    contextMenuEntry.displayValue,
                );
                break;
            case "copy-as-text": {
                if (!activeSessionId || !connection) break;
                const text = (await connection.sendRequest(
                    "variables/formatForClipboard",
                    {
                        path: contextMenuEntry.path,
                        format: "text/plain",
                        sessionId: activeSessionId,
                    },
                )) as string;
                await navigator.clipboard.writeText(text);
                break;
            }
            case "copy-as-html": {
                if (!activeSessionId || !connection) break;
                const text = (await connection.sendRequest(
                    "variables/formatForClipboard",
                    {
                        path: contextMenuEntry.path,
                        format: "text/html",
                        sessionId: activeSessionId,
                    },
                )) as string;
                await writeClipboardContent(text, "text/html");
                break;
            }
            case "expand-item":
            case "collapse-item":
                await toggleItem(contextMenuEntry);
                break;
            case "view":
                await viewVariable(contextMenuEntry);
                break;
        }
    }

    async function deleteAllVariables() {
        if (!connection || !activeSessionId || activeInstanceDisabled) return;

        try {
            await connection.sendRequest("variables/clear", {
                sessionId: activeSessionId,
            });
            showDeleteAllDialog = false;
        } catch (error) {
            console.error("Failed to delete all variables:", error);
        }
    }

    async function viewVariable(entry: IVariableItem) {
        if (!connection || !activeSessionId || !entry.hasViewer || activeInstanceDisabled) return;

        viewerLoadingEntryIds.add(entry.id);

        try {
            await connection.sendRequest("variables/view", {
                path: entry.path,
                sessionId: activeSessionId,
            });
        } catch (error) {
            console.error("Failed to view variable:", error);
        } finally {
            viewerLoadingEntryIds.delete(entry.id);
        }
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (!currentEntries.length || activeInstanceDisabled) return;

        const selectedEntry = getSelectedEntry();
        const currentIndex = selectedEntry
            ? currentEntries.findIndex((entry) => entry.id === selectedEntry.id)
            : -1;

        switch (event.key) {
            case "Home":
                event.preventDefault();
                selectEntry(currentEntries[0], 0);
                return;
            case "End":
                event.preventDefault();
                selectEntry(currentEntries[currentEntries.length - 1], currentEntries.length - 1);
                return;
            case "PageDown": {
                event.preventDefault();
                const pageSize = Math.max(1, Math.floor(containerHeight / VARIABLE_ROW_HEIGHT));
                const nextIndex = Math.min(
                    currentEntries.length - 1,
                    Math.max(0, currentIndex) + pageSize,
                );
                selectEntry(currentEntries[nextIndex], nextIndex);
                return;
            }
            case "PageUp": {
                event.preventDefault();
                const pageSize = Math.max(1, Math.floor(containerHeight / VARIABLE_ROW_HEIGHT));
                const nextIndex = Math.max(0, (currentIndex === -1 ? 0 : currentIndex) - pageSize);
                selectEntry(currentEntries[nextIndex], nextIndex);
                return;
            }
            case "ArrowDown": {
                event.preventDefault();
                const nextIndex =
                    currentIndex < currentEntries.length - 1
                        ? currentIndex + 1
                        : currentEntries.length - 1;
                selectEntry(currentEntries[nextIndex], nextIndex);
                return;
            }
            case "ArrowUp": {
                event.preventDefault();
                const nextIndex =
                    currentIndex === -1
                        ? currentEntries.length - 1
                        : Math.max(currentIndex - 1, 0);
                selectEntry(currentEntries[nextIndex], nextIndex);
                return;
            }
            case "Enter": {
                event.preventDefault();
                if (!selectedEntry) return;
                if (isVariableGroup(selectedEntry)) {
                    void toggleGroup(selectedEntry);
                } else if (isVariableItem(selectedEntry)) {
                    if (selectedEntry.hasViewer) {
                        void viewVariable(selectedEntry);
                    } else if (selectedEntry.hasChildren) {
                        void toggleItem(selectedEntry);
                    }
                }
                return;
            }
            case "Escape":
                event.preventDefault();
                clearSelection();
                return;
            case "ArrowRight":
                event.preventDefault();
                if (!selectedEntry) return;
                if (
                    isVariableGroup(selectedEntry) &&
                    !selectedEntry.isExpanded
                ) {
                    void toggleGroup(selectedEntry);
                } else if (
                    isVariableItem(selectedEntry) &&
                    selectedEntry.hasChildren &&
                    !selectedEntry.isExpanded
                ) {
                    void toggleItem(selectedEntry);
                }
                return;
            case "ArrowLeft":
                event.preventDefault();
                if (!selectedEntry) return;
                if (
                    isVariableGroup(selectedEntry) &&
                    selectedEntry.isExpanded
                ) {
                    void toggleGroup(selectedEntry);
                } else if (
                    isVariableItem(selectedEntry) &&
                    selectedEntry.hasChildren &&
                    selectedEntry.isExpanded
                ) {
                    void toggleItem(selectedEntry);
                }
                return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectedEntry) {
            event.preventDefault();
            void copySelectedEntry(selectedEntry, event.shiftKey ? "text/html" : "text/plain");
        }
    }

    async function copySelectedEntry(entry: VariableEntry, format: "text/plain" | "text/html") {
        if (!isVariableItem(entry) || !connection || !activeSessionId) return;
        const text = (await connection.sendRequest("variables/formatForClipboard", {
            path: entry.path,
            format,
            sessionId: activeSessionId,
        })) as string;
        await writeClipboardContent(text, format);
    }

    async function writeClipboardContent(
        text: string,
        format: "text/plain" | "text/html",
    ) {
        if (
            format === "text/html" &&
            typeof ClipboardItem !== "undefined" &&
            typeof navigator.clipboard.write === "function"
        ) {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([text], { type: "text/html" }),
                }),
            ]);
            return;
        }
        await navigator.clipboard.writeText(text);
    }

    function scrollEntryIntoView(
        id: string,
        behavior: ScrollBehavior = "auto",
        knownIndex = -1,
    ) {
        if (!variablesContainer) return;
        const index = knownIndex >= 0
            ? knownIndex
            : currentEntries.findIndex((entry) => entry.id === id);
        if (index < 0) return;
        const top = index * VARIABLE_ROW_HEIGHT;
        const bottom = top + VARIABLE_ROW_HEIGHT;
        if (top < variablesContainer.scrollTop) {
            variablesContainer.scrollTo({ top, behavior });
        } else if (bottom > variablesContainer.scrollTop + variablesContainer.clientHeight) {
            variablesContainer.scrollTo({
                top: bottom - variablesContainer.clientHeight,
                behavior,
            });
        }
    }

    function beginResizeNameColumn() {
        const bounds = getNameColumnBounds(
            containerWidth,
            MINIMUM_NAME_COLUMN_WIDTH,
        );
        return {
            minimumWidth: bounds.minimum,
            maximumWidth: bounds.maximum,
            startingWidth: nameColumnWidth,
        };
    }

    function resizeNameColumn(newNameColumnWidth: number) {
        const layout = calculateVariablesColumnLayout(
            containerWidth,
            newNameColumnWidth,
            MINIMUM_NAME_COLUMN_WIDTH,
            RIGHT_COLUMN_VISIBILITY_THRESHOLD,
        );
        nameColumnWidth = layout.nameWidth;
        detailsColumnWidth = layout.detailsWidth;
        rightColumnVisible = layout.rightColumnVisible;
        if (activeSessionId) {
            const data = ensureSessionData(activeSessionId);
            data.nameColumnWidth = nameColumnWidth;
            sessionDataMap.set(activeSessionId, { ...data });
        }
    }

    function persistSelection() {
        if (activeSessionId) {
            const data = ensureSessionData(activeSessionId);
            data.selectedEntryId = selectedEntryId;
            sessionDataMap.set(activeSessionId, { ...data });
        }
    }

    function handleContainerScroll(event: Event) {
        scrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
        if (activeSessionId) {
            const data = ensureSessionData(activeSessionId);
            data.scrollOffset = scrollTop;
            sessionDataMap.set(activeSessionId, { ...data });
        }
    }

    function formatSize(size: number): string {
        const KB = 1024;
        const MB = KB * KB;
        const GB = MB * KB;
        const TB = GB * KB;

        if (!size || isNaN(size)) size = 0;

        if (size < KB) {
            return size === 1 ? `${size} Byte` : `${size} Bytes`;
        }
        if (size < MB) {
            return `${(size / KB).toFixed(2)} KB`;
        }
        if (size < GB) {
            return `${(size / MB).toFixed(2)} MB`;
        }
        if (size < TB) {
            return `${(size / GB).toFixed(2)} GB`;
        }
        return `${(size / TB).toFixed(2)} TB`;
    }
</script>

<div class="positron-variables">
    <ActionBars
        filterText={filterText}
        grouping={groupingMode}
        sorting={sortingMode}
        highlightRecent={highlightRecent}
        instances={variablesInstances}
        activeInstanceId={activeVariablesInstanceId ?? activeSessionId}
        hasActiveInstance={variablesInstances.length > 0}
        {memoryUsageEnabled}
        {memoryUsageSnapshot}
        {activeInstanceDisabled}
        onrefresh={refreshActiveSession}
        ondeleteAll={() => (showDeleteAllDialog = true)}
        onfilterChange={handleFilterChange}
        ongroupingChange={handleGroupingChange}
        onsortingChange={handleSortingChange}
        onhighlightRecentChange={handleHighlightRecentChange}
        onselectInstance={selectVariablesInstance}
        onconfigureMemory={() =>
            connection?.sendRequest("variables/openMemorySettings")}
    />

    {#if showBusyProgress}
        <div class="variables-progress" aria-hidden="true">
            <div class="variables-progress-bar"></div>
        </div>
    {/if}

    <div
        class="variables-container"
        class:disabled={activeInstanceDisabled}
        bind:this={variablesContainer}
        bind:clientWidth={containerWidth}
        bind:clientHeight={containerHeight}
        tabindex="0"
        role="tree"
        aria-activedescendant={selectedEntryId
            ? `variable-entry-${selectedEntryId}`
            : undefined}
        data-saved-scroll-offset={activeSessionId
            ? getSessionData(activeSessionId).scrollOffset
            : 0}
        aria-disabled={activeInstanceDisabled}
        onkeydown={handleKeyDown}
        onscroll={handleContainerScroll}
        onwheel={() => (lastManualScrollTime = Date.now())}
        onpointerdown={() => (lastManualScrollTime = Date.now())}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
    >
        {#if loading}
            <VariablesEmpty initializing={true} />
        {:else if currentEntries.length === 0}
            <VariablesEmpty
                hasFilter={filterText.length > 0}
                message={!activeSessionId
                    ? localize("variables.noActiveSession", "There is no active session.")
                    : undefined}
            />
        {:else}
            <div
                class="variables-list virtualized"
                style:height={`${currentEntries.length * VARIABLE_ROW_HEIGHT}px`}
            >
                <div
                    class="variables-list-window"
                    style:transform={`translateY(${visibleStartIndex * VARIABLE_ROW_HEIGHT}px)`}
                >
                {#each visibleEntries as entry (entry.id)}
                    {#if isVariableGroup(entry)}
                        <VariableGroup
                            groupId={entry.id}
                            title={entry.title}
                            expanded={entry.isExpanded}
                            selected={selectedEntryId === entry.id}
                            {focused}
                            disabled={activeInstanceDisabled}
                            onselect={() => handleGroupSelect(entry)}
                            ondeselect={clearSelection}
                            ontoggleExpand={() => toggleGroup(entry)}
                            oncontextMenu={({ x, y }) =>
                                handleGroupContextMenu(entry, x, y)}
                        />
                    {:else if isVariableItem(entry)}
                        <VariableItem
                            id={entry.id}
                            indentLevel={entry.indentLevel}
                            displayName={entry.displayName}
                            displayValue={entry.displayValue}
                            hasChildren={entry.hasChildren}
                            hasViewer={entry.hasViewer}
                            isExpanded={entry.isExpanded}
                            kind={entry.kind}
                            {nameColumnWidth}
                            {detailsColumnWidth}
                            {rightColumnVisible}
                            selected={selectedEntryId === entry.id}
                            {focused}
                            disabled={activeInstanceDisabled}
                            recent={highlightRecent &&
                                currentRecentEntryIds.has(entry.id)}
                            viewerLoading={viewerLoadingEntryIds.has(entry.id)}
                            rightText={sortingMode === "size" &&
                            entry.size !== undefined
                                ? formatSize(entry.size)
                                : entry.displayType}
                            onselect={handleItemSelect}
                            ondeselect={clearSelection}
                            ontoggleExpand={handleItemToggle}
                            onview={handleItemView}
                            oncontextMenu={handleItemContextMenu}
                            onBeginResizeNameColumn={beginResizeNameColumn}
                            onResizeNameColumn={resizeNameColumn}
                        />
                    {:else if isVariableOverflow(entry)}
                        <VariableOverflow
                            entryId={entry.id}
                            overflowValues={entry.overflowValues}
                            indentLevel={entry.indentLevel}
                            {nameColumnWidth}
                            {detailsColumnWidth}
                            selected={selectedEntryId === entry.id}
                            {focused}
                            disabled={activeInstanceDisabled}
                            onBeginResizeNameColumn={beginResizeNameColumn}
                            onResizeNameColumn={resizeNameColumn}
                            onselect={() => handleOverflowSelect(entry)}
                            ondeselect={clearSelection}
                        />
                    {/if}
                {/each}
                </div>
            </div>
        {/if}
    </div>
</div>

{#if contextMenuVisible && contextMenuEntry}
    {@const menuItems = getContextMenuItems(contextMenuEntry)}
    {#if menuItems.length > 0}
        <ContextMenu
            items={menuItems}
            position={contextMenuPosition}
            onSelect={handleContextMenuSelect}
            onClose={() => {
                contextMenuVisible = false;
                queueMicrotask(() => variablesContainer?.focus());
            }}
        />
    {/if}
{/if}

{#if showDeleteAllDialog}
    <ConfirmDialog
        title={localize("variables.deleteAllTitle", "Delete All Variables")}
        message={localize("variables.deleteAllMessage", "Are you sure you want to delete all variables? This operation cannot be undone.")}
        confirmLabel={localize("variables.delete", "Delete")}
        cancelLabel={localize("common.cancel", "Cancel")}
        onConfirm={deleteAllVariables}
        onCancel={() => (showDeleteAllDialog = false)}
    />
{/if}

<style>
    .positron-variables {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--vscode-positronVariables-background, var(--vscode-panel-background));
        color: var(--vscode-positronVariables-foreground, var(--vscode-editor-foreground));
        font-family: inherit;
        font-size: var(--vscode-font-size, 13px);
        font-weight: inherit;
    }

    .variables-container {
        position: relative;
        flex: 1;
        overflow-y: auto;
    }

    .variables-progress {
        position: relative;
        height: 2px;
        overflow: hidden;
        background: color-mix(
            in srgb,
            var(--vscode-progressBar-background, var(--vscode-focusBorder))
                18%,
            transparent
        );
    }

    .variables-progress-bar {
        position: absolute;
        inset: 0 auto 0 0;
        width: 38%;
        background: var(
            --vscode-progressBar-background,
            var(--vscode-focusBorder)
        );
        animation: variables-progress-slide 1.1s ease-in-out infinite;
    }

    .variables-list {
        display: flex;
        flex-direction: column;
    }

    .variables-list.virtualized {
        position: relative;
        display: block;
    }

    .variables-list-window {
        position: absolute;
        inset: 0 0 auto 0;
    }

    @keyframes variables-progress-slide {
        0% {
            transform: translateX(-100%);
        }

        100% {
            transform: translateX(300%);
        }
    }
</style>
