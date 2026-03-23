<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { getRpcConnection } from "$lib/rpc/client";
    import ActionBars from "./ActionBars.svelte";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import VariableGroup from "./VariableGroup.svelte";
    import VariableItem from "./VariableItem.svelte";
    import VariableOverflow from "./VariableOverflow.svelte";
    import VariablesEmpty from "./VariablesEmpty.svelte";
    import { patchEntries } from "./patchEntries";
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
        recentEntryIds: Set<string>;
        loaded: boolean;
    }

    const DEFAULT_NAME_COLUMN_WIDTH = 130;
    const MINIMUM_NAME_COLUMN_WIDTH = 100;
    const RIGHT_COLUMN_VISIBILITY_THRESHOLD = 250;
    const DEFAULT_GROUPING: GroupingMode = "kind";
    const DEFAULT_SORTING: SortingMode = "name";
    const DEFAULT_FILTER_TEXT = "";
    const DEFAULT_HIGHLIGHT_RECENT = true;

    let sessions = $state<SessionInfo[]>([]);
    let activeSessionId = $state<string | undefined>();
    let activeVariablesInstanceId = $state<string | undefined>();
    let sessionDataMap = $state(new Map<string, SessionVariablesData>());
    let variablesInstanceMap = $state(new Map<string, VariablesInstanceInfo>());

    let loading = $state(true);
    let connection = $state<MessageConnection | undefined>();
    let selectedEntryId = $state<string | null>(null);
    let focused = $state(false);

    let containerWidth = $state(0);
    let nameColumnWidth = $state(DEFAULT_NAME_COLUMN_WIDTH);
    let detailsColumnWidth = $state(0);
    let rightColumnVisible = $state(true);
    let containerRef: HTMLDivElement;

    let groupingMode = $state<GroupingMode>(DEFAULT_GROUPING);
    let sortingMode = $state<SortingMode>(DEFAULT_SORTING);
    let filterText = $state(DEFAULT_FILTER_TEXT);
    let highlightRecent = $state(DEFAULT_HIGHLIGHT_RECENT);

    let contextMenuVisible = $state(false);
    let contextMenuPosition = $state({ x: 0, y: 0 });
    let contextMenuEntry = $state<VariableEntry | null>(null);
    let showDeleteAllDialog = $state(false);
    let viewerLoadingEntryIds = $state<Set<string>>(new Set());

    function getSessionData(sessionId: string): SessionVariablesData {
        return (
            sessionDataMap.get(sessionId) ?? {
                entries: [],
                recentEntryIds: new Set(),
                loaded: false,
            }
        );
    }

    function ensureSessionData(sessionId: string): SessionVariablesData {
        let data = sessionDataMap.get(sessionId);
        if (!data) {
            data = {
                entries: [],
                recentEntryIds: new Set(),
                loaded: false,
            };
            sessionDataMap.set(sessionId, data);
            sessionDataMap = new Map(sessionDataMap);
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
    const showBusyProgress = $derived(
        !loading && activeVariablesInstance?.status === "busy",
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
        const newDetailsColumnWidth = Math.max(
            containerWidth - nameColumnWidth,
            Math.trunc(containerWidth / 3),
        );
        nameColumnWidth = containerWidth - newDetailsColumnWidth;
        detailsColumnWidth = newDetailsColumnWidth;
        rightColumnVisible =
            newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD;
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

    let resizeObserver: ResizeObserver | undefined;

    onMount(() => {
        connection = getRpcConnection();

        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                containerWidth = entry.contentRect.width;
            }
        });
        if (containerRef) {
            resizeObserver.observe(containerRef);
        }

        connection.onNotification(
            "variables/entriesChanged",
            (params: { sessionId: string; entries: VariableEntry[] }) => {
                const data = ensureSessionData(params.sessionId);
                data.loaded = true;
                const { entries, changed } = patchEntries(
                    data.entries,
                    params.entries,
                );
                if (changed) {
                    data.entries = entries;
                    sessionDataMap = new Map(sessionDataMap);
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

        connection.onNotification(
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
                    }
                }
                variablesInstanceMap = new Map(variablesInstanceMap);
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

                activeSessionId = resolveActiveSessionId(
                    params.sessions,
                    activeVariablesInstanceId ?? params.activeSessionId,
                    previousActiveSessionId,
                );

                if (!activeSessionId) {
                    loading = false;
                    return;
                }

                if (activeSessionId !== previousActiveSessionId) {
                    selectedEntryId = null;
                }

                if (!getSessionData(activeSessionId).loaded) {
                    void refreshEntries(activeSessionId);
                } else {
                    loading = false;
                }
            },
        );

        connection.onNotification(
            "variables/instanceStarted",
            (params: { instance: VariablesInstanceInfo }) => {
                variablesInstanceMap.set(
                    params.instance.sessionId,
                    params.instance,
                );
                variablesInstanceMap = new Map(variablesInstanceMap);
            },
        );

        connection.onNotification(
            "variables/instanceStopped",
            (params: { sessionId: string }) => {
                variablesInstanceMap.delete(params.sessionId);
                variablesInstanceMap = new Map(variablesInstanceMap);

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

        connection.onNotification(
            "variables/activeInstanceChanged",
            (params: { sessionId?: string }) => {
                const previousActiveSessionId = activeSessionId;
                activeVariablesInstanceId = params.sessionId;
                activeSessionId = resolveActiveSessionId(
                    sessions,
                    params.sessionId,
                    activeSessionId,
                );

                if (
                    activeSessionId &&
                    activeSessionId !== previousActiveSessionId
                ) {
                    selectedEntryId = null;
                    if (!getSessionData(activeSessionId).loaded) {
                        void refreshEntries(activeSessionId);
                    } else {
                        loading = false;
                    }
                }
            },
        );

        connection.sendNotification("variables/ready");
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
    });

    function applyRecentEntries(sessionId: string, entries: VariableEntry[]) {
        const recentIds = entries.flatMap((entry) =>
            isVariableItem(entry) && entry.isRecent ? [entry.id] : [],
        );
        if (!recentIds.length) {
            return;
        }

        const data = ensureSessionData(sessionId);
        data.recentEntryIds = new Set([
            ...Array.from(data.recentEntryIds),
            ...recentIds,
        ]);
        sessionDataMap = new Map(sessionDataMap);

        setTimeout(() => {
            const sessionData = sessionDataMap.get(sessionId);
            if (!sessionData) {
                return;
            }

            sessionData.recentEntryIds = new Set(
                Array.from(sessionData.recentEntryIds).filter(
                    (id) => !recentIds.includes(id),
                ),
            );
            sessionDataMap = new Map(sessionDataMap);
        }, 2000);
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
                },
            )) as { entries: VariableEntry[] };

            const data = ensureSessionData(targetSessionId);
            data.loaded = true;
            const { entries, changed } = patchEntries(
                data.entries,
                result.entries,
            );
            if (changed) {
                data.entries = entries;
                sessionDataMap = new Map(sessionDataMap);
            }
            applyRecentEntries(targetSessionId, result.entries);
        } catch (error) {
            console.error("Failed to fetch variable entries:", error);
        } finally {
            loading = false;
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
            await connection.sendRequest("variables/setActiveSession", {
                sessionId,
            });
            activeVariablesInstanceId = sessionId;
            activeSessionId = sessionId;
            selectedEntryId = null;
            if (!getSessionData(sessionId).loaded) {
                await refreshEntries(sessionId);
            } else {
                loading = false;
            }
        } catch (error) {
            console.error("Failed to select variables session:", error);
        }
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

    async function handleFilterChange(text: string) {
        filterText = text;
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
        selectedEntryId = entry.id;
    }

    function handleGroupContextMenu(
        entry: IVariableGroup,
        x: number,
        y: number,
    ) {
        selectedEntryId = entry.id;
        showContextMenu(entry, x, y);
    }

    async function toggleGroup(entry: IVariableGroup) {
        if (!connection || !activeSessionId) return;

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
        if (!connection || !activeSessionId || !entry.hasChildren) return;

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
        selectedEntryId = id;
    }

    function handleItemContextMenu(
        id: string,
        x: number,
        y: number,
    ) {
        const entry = findItemById(id);
        if (!entry) return;
        selectedEntryId = id;
        showContextMenu(entry, x, y);
    }

    function handleItemView(id: string) {
        const entry = findItemById(id);
        if (entry) viewVariable(entry);
    }

    function handleOverflowSelect(entry: VariableEntry) {
        selectedEntryId = entry.id;
    }

    function selectEntry(entry: VariableEntry, index: number = -1) {
        selectedEntryId = entry.id;
        void index;
    }

    function clearSelection() {
        selectedEntryId = null;
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
                    label: entry.isExpanded ? "Collapse" : "Expand",
                    icon: entry.isExpanded
                        ? "codicon-chevron-up"
                        : "codicon-chevron-down",
                },
            ];
        }

        if (!isVariableItem(entry)) {
            return [];
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
                        ? "View Data Table"
                        : entry.kind === "connection"
                          ? "View Connection"
                          : "View",
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
                label: entry.isExpanded ? "Collapse" : "Expand",
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
            label: "Copy Name",
            icon: "codicon-copy",
        });
        items.push({
            id: "copy-value",
            label: "Copy Value",
            icon: "codicon-copy",
        });
        items.push({ id: "sep-format", label: "", separator: true });
        items.push({ id: "copy-as-text", label: "Copy as Text" });
        items.push({ id: "copy-as-html", label: "Copy as HTML" });

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

        if (!isVariableItem(contextMenuEntry) || !connection) {
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
                if (!activeSessionId) break;
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
                if (!activeSessionId) break;
                const text = (await connection.sendRequest(
                    "variables/formatForClipboard",
                    {
                        path: contextMenuEntry.path,
                        format: "text/html",
                        sessionId: activeSessionId,
                    },
                )) as string;
                await navigator.clipboard.writeText(text);
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
        if (!connection || !activeSessionId) return;

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
        if (!connection || !activeSessionId || !entry.hasViewer) return;

        viewerLoadingEntryIds.add(entry.id);
        viewerLoadingEntryIds = new Set(viewerLoadingEntryIds);

        try {
            await connection.sendRequest("variables/view", {
                path: entry.path,
                sessionId: activeSessionId,
            });
        } catch (error) {
            console.error("Failed to view variable:", error);
        } finally {
            viewerLoadingEntryIds.delete(entry.id);
            viewerLoadingEntryIds = new Set(viewerLoadingEntryIds);
        }
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (!currentEntries.length) return;

        const selectedEntry = getSelectedEntry();
        const currentIndex = selectedEntry
            ? currentEntries.findIndex((entry) => entry.id === selectedEntry.id)
            : -1;

        switch (event.key) {
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
    }

    function beginResizeNameColumn() {
        return {
            minimumWidth: MINIMUM_NAME_COLUMN_WIDTH,
            maximumWidth: Math.trunc((2 * containerWidth) / 3),
            startingWidth: nameColumnWidth,
        };
    }

    function resizeNameColumn(newNameColumnWidth: number) {
        const newDetailsColumnWidth = containerWidth - newNameColumnWidth;
        nameColumnWidth = newNameColumnWidth;
        detailsColumnWidth = newDetailsColumnWidth;
        rightColumnVisible =
            newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD;
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
        onrefresh={refreshActiveSession}
        ondeleteAll={() => (showDeleteAllDialog = true)}
        onfilterChange={handleFilterChange}
        ongroupingChange={handleGroupingChange}
        onsortingChange={handleSortingChange}
        onhighlightRecentChange={handleHighlightRecentChange}
        onselectInstance={selectVariablesInstance}
    />

    {#if showBusyProgress}
        <div class="variables-progress" aria-hidden="true">
            <div class="variables-progress-bar"></div>
        </div>
    {/if}

    <div
        class="variables-container"
        bind:this={containerRef}
        tabindex="0"
        role="listbox"
        onkeydown={handleKeyDown}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
    >
        {#if loading}
            <div class="variables-empty">
                <span class="codicon codicon-loading spin"></span>
                <span>Loading variables...</span>
            </div>
        {:else if currentEntries.length === 0}
            <VariablesEmpty
                hasFilter={filterText.length > 0}
                message={filterText
                    ? "No matching variables"
                    : "No variables have been created."}
            />
        {:else}
            <div class="variables-list">
                {#each currentEntries as entry (entry.id)}
                    {#if isVariableGroup(entry)}
                        <VariableGroup
                            groupId={entry.id}
                            title={entry.title}
                            expanded={entry.isExpanded}
                            selected={selectedEntryId === entry.id}
                            {focused}
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
                            overflowValues={entry.overflowValues}
                            indentLevel={entry.indentLevel}
                            {nameColumnWidth}
                            {detailsColumnWidth}
                            selected={selectedEntryId === entry.id}
                            {focused}
                            onselect={() => handleOverflowSelect(entry)}
                            ondeselect={clearSelection}
                        />
                    {/if}
                {/each}
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
            onClose={() => (contextMenuVisible = false)}
        />
    {/if}
{/if}

{#if showDeleteAllDialog}
    <ConfirmDialog
        title="Delete All Variables"
        message="Are you sure you want to delete all variables? This operation cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={deleteAllVariables}
        onCancel={() => (showDeleteAllDialog = false)}
    />
{/if}

<style>
    .positron-variables {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground);
        font-family: inherit;
        font-size: var(--vscode-font-size, 13px);
        font-weight: inherit;
    }

    .variables-container {
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

    .variables-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        color: var(--vscode-descriptionForeground);
        gap: 8px;
    }

    .variables-empty .codicon {
        font-size: 32px;
        opacity: 0.5;
    }

    .variables-list {
        display: flex;
        flex-direction: column;
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
