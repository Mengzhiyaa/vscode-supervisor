<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { getRpcConnection } from "$lib/rpc/client";
    import { localize } from "$lib/localization";

    interface PackageItem {
        id: string;
        name: string;
        displayName: string;
        version: string;
        license?: string;
        latestVersion?: string;
        publishedDate?: string;
        attached?: boolean;
        outdated?: boolean;
        description?: string;
    }

    interface PackageSpec {
        name: string;
        version?: string;
    }

    interface SessionState {
        id: string;
        name: string;
        runtimeName: string;
        languageId: string;
        state: string;
    }

    interface PackagesState {
        revision?: number;
        cancelled?: boolean;
        packages: PackageItem[];
        activeSession?: SessionState;
        busy: boolean;
        selectedPackage?: string;
        itemSize: "card" | "row";
    }

    let connection = $state<MessageConnection | undefined>();
    let packages = $state<PackageItem[]>([]);
    let activeSession = $state<SessionState | undefined>();
    let hostBusy = $state(false);
    let requestPending = $state(false);
    const busy = $derived(hostBusy || requestPending);
    let sessionGeneration = 0;
    let searchGeneration = 0;
    let lastRevision = -1;
    let selectedPackage = $state<string | undefined>();
    let itemSize = $state<"card" | "row">("card");
    let filterText = $state("");
    let installText = $state("");
    let searchText = $state("");
    let searchResults = $state<PackageItem[]>([]);
    let searchLoading = $state(false);
    let operationError = $state<string | undefined>();

    const deduplicatedPackages = $derived.by(() => {
        const seen = new Set<string>();
        return packages.filter((pkg) => {
            const key = pkg.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });

    const parsedFilter = $derived.by(() => {
        let outdated = false;
        let attached = false;
        let descending = false;
        const text = filterText.replace(/@(\w+)(?::([\w-]+))?/gi, (_match, key: string, value?: string) => {
            key = key.toLowerCase();
            value = value?.toLowerCase();
            if (key === "sort" && (value === "name" || value === "name-desc")) {
                descending = value === "name-desc";
            } else if (value === undefined) {
                outdated ||= key === "outdated";
                attached ||= key === "attached";
            }
            return "";
        }).replace(/\s+/g, " ").trim().toLowerCase();
        return { text, outdated, attached, descending };
    });

    const filteredPackages = $derived(
        deduplicatedPackages.filter((pkg) => {
            if (parsedFilter.outdated && !pkg.outdated) return false;
            if (parsedFilter.attached && !pkg.attached) return false;
            if (!parsedFilter.text) return true;
            return (
                pkg.name.toLowerCase().includes(parsedFilter.text) ||
                pkg.displayName.toLowerCase().includes(parsedFilter.text) ||
                (pkg.description ?? "").toLowerCase().includes(parsedFilter.text)
            );
        }).sort((a, b) => {
            const result = a.name.localeCompare(b.name);
            return parsedFilter.descending ? -result : result;
        }),
    );

    const installedPackageNames = $derived(
        new Set(deduplicatedPackages.map((pkg) => pkg.name.toLowerCase())),
    );

    const outdatedCount = $derived(
        deduplicatedPackages.filter((pkg) => pkg.outdated).length,
    );

    function applyState(state: PackagesState): void {
        if (state.revision !== undefined) {
            if (state.revision < lastRevision) return;
            lastRevision = state.revision;
        }
        if (state.activeSession?.id !== activeSession?.id) {
            sessionGeneration++;
            searchGeneration++;
            searchResults = [];
            searchText = "";
            searchLoading = false;
            installText = "";
            operationError = undefined;
            requestPending = false;
        }
        packages = state.packages ?? [];
        activeSession = state.activeSession;
        hostBusy = state.busy;
        selectedPackage = state.selectedPackage;
        itemSize = state.itemSize ?? "card";
    }

    function formatError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    async function requestState(): Promise<void> {
        if (!connection) {
            return;
        }
        const state = (await connection.sendRequest(
            "packages/getState",
        )) as PackagesState;
        applyState(state);
    }

    async function runStateRequest(method: string, params: Record<string, unknown> = {}): Promise<boolean> {
        if (!connection || !activeSession || busy) {
            return false;
        }

        operationError = undefined;
        const generation = sessionGeneration;
        requestPending = true;
        try {
            const state = (await connection.sendRequest(
                method,
                { ...params, sessionId: activeSession.id },
            )) as PackagesState;
            if (generation !== sessionGeneration) return false;
            applyState(state);
            return generation === sessionGeneration && !state.cancelled;
        } catch (error) {
            if (generation === sessionGeneration) operationError = formatError(error);
            return false;
        } finally {
            if (generation === sessionGeneration) requestPending = false;
        }
    }

    function parsePackageSpecs(value: string): PackageSpec[] {
        return value
            .split(/[\s,]+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const separatorIndex = entry.indexOf("@");
                if (separatorIndex <= 0) {
                    return { name: entry };
                }
                return {
                    name: entry.substring(0, separatorIndex),
                    version: entry.substring(separatorIndex + 1) || undefined,
                };
            });
    }

    async function refreshPackages(): Promise<void> {
        await runStateRequest("packages/refresh");
    }

    async function updateAllPackages(): Promise<void> {
        await runStateRequest("packages/updateAll");
    }

    async function installFromInput(): Promise<void> {
        const specs = parsePackageSpecs(installText);
        if (specs.length === 0) {
            return;
        }

        if (await runStateRequest("packages/install", { packages: specs })) {
            installText = "";
        }
    }

    async function installPackage(pkg: PackageItem): Promise<void> {
        await runStateRequest("packages/install", {
            packages: [{ name: pkg.name }],
            chooseVersion: true,
        });
    }

    async function updatePackage(pkg: PackageItem): Promise<void> {
        await runStateRequest("packages/update", {
            packages: [{ name: pkg.name }],
            chooseVersion: true,
        });
    }

    async function uninstallPackage(pkg: PackageItem): Promise<void> {
        await runStateRequest("packages/uninstall", {
            packageNames: [pkg.name],
        });
    }

    async function searchPackages(): Promise<void> {
        const query = searchText.trim();
        if (!query || !connection || !activeSession) {
            searchResults = [];
            return;
        }

        operationError = undefined;
        const generation = ++searchGeneration;
        searchLoading = true;
        try {
            const results = (await connection.sendRequest("packages/search", {
                query,
                sessionId: activeSession.id,
            })) as PackageItem[];
            if (generation !== searchGeneration) return;
            const seen = new Set<string>();
            const uniqueResults = results.filter((pkg) => {
                const key = pkg.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const exactIndex = uniqueResults.findIndex(pkg => pkg.name.toLowerCase() === query.toLowerCase());
            if (exactIndex > 0) uniqueResults.unshift(...uniqueResults.splice(exactIndex, 1));
            searchResults = uniqueResults.slice(0, 100);
        } catch (error) {
            if (generation === searchGeneration) {
                operationError = formatError(error);
                searchResults = [];
            }
        } finally {
            if (generation === searchGeneration) searchLoading = false;
        }
    }

    function selectPackage(pkg: PackageItem): void {
        selectedPackage = pkg.name;
        connection?.sendNotification("packages/setSelected", { name: pkg.name, sessionId: activeSession?.id });
    }

    function selectPackageFromKeyboard(event: KeyboardEvent, pkg: PackageItem): void {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectPackage(pkg);
        } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            const element = event.currentTarget as HTMLElement;
            const entries = Array.from(element.parentElement?.querySelectorAll<HTMLElement>(".package-item, .search-result") ?? []);
            const current = entries.indexOf(element);
            const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
                : Math.max(0, Math.min(entries.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            event.preventDefault();
            entries[next]?.focus();
            entries[next]?.click();
        }
    }

    function clearSelection(): void {
        selectedPackage = undefined;
        connection?.sendNotification("packages/setSelected", { sessionId: activeSession?.id });
    }

    function toggleFilter(filter: "outdated" | "attached"): void {
        const active = parsedFilter[filter];
        filterText = filterText.replace(/@(\w+)(?::([\w-]+))?/gi, (match, key: string, value?: string) =>
            key.toLowerCase() === filter && value === undefined ? "" : match).replace(/\s+/g, " ").trim();
        if (!active) filterText = `@${filter} ${filterText}`.trim();
        clearSelection();
    }

    function toggleSort(): void {
        const sort = parsedFilter.descending ? "name" : "name-desc";
        filterText = `@sort:${sort} ${filterText.replace(/@sort:[\w-]+/gi, "").trim()}`.trim();
        clearSelection();
    }

    function setItemSize(nextSize: "card" | "row"): void {
        itemSize = nextSize;
        connection?.sendNotification("packages/setItemSize", {
            itemSize: nextSize,
        });
    }

    function clearSearch(): void {
        searchGeneration++;
        searchLoading = false;
        searchText = "";
        searchResults = [];
    }

    function onInstallKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            void installFromInput();
        }
    }

    function onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            void searchPackages();
        }
    }

    onMount(() => {
        const rpc = getRpcConnection();
        connection = rpc;
        const stateDisposable = rpc.onNotification(
            "packages/state",
            (state: unknown) => applyState(state as PackagesState),
        );
        void requestState().catch(error => { operationError = formatError(error); });

        return () => {
            stateDisposable.dispose();
        };
    });

    onDestroy(() => {
        sessionGeneration++;
        searchGeneration++;
        connection = undefined;
    });
</script>

<main class="packages-view" class:busy>
    <header class="packages-toolbar">
        <div class="session-label" title={activeSession?.name ?? ""}>
            {#if activeSession}
                <span class="codicon codicon-debug-start"></span>
                <span class="session-name">{activeSession.name}</span>
            {:else}
                <span class="codicon codicon-package"></span>
                <span class="session-name">Packages</span>
            {/if}
        </div>
        <div class="toolbar-actions">
            <button
                class:active={itemSize === "card"}
                title="Card view"
                aria-label="Card view"
                disabled={busy}
                onclick={() => setItemSize("card")}
            >
                <span class="codicon codicon-list-selection"></span>
            </button>
            <button
                class:active={itemSize === "row"}
                title="Row view"
                aria-label="Row view"
                disabled={busy}
                onclick={() => setItemSize("row")}
            >
                <span class="codicon codicon-list-flat"></span>
            </button>
            <button
                title="Refresh"
                aria-label="Refresh"
                disabled={!activeSession || busy}
                onclick={refreshPackages}
            >
                <span
                    class="codicon"
                    class:codicon-refresh={!busy}
                    class:codicon-loading={busy}
                    class:spin={busy}
                ></span>
            </button>
        </div>
    </header>

    {#if operationError}
        <div class="error-row" title={operationError}>
            <span class="codicon codicon-warning"></span>
            <span>{operationError}</span>
        </div>
    {/if}

    {#if activeSession}
        <section class="package-controls">
            <div class="input-row">
                <input
                    type="text"
                    placeholder="pkg or pkg@version"
                    bind:value={installText}
                    disabled={busy}
                    onkeydown={onInstallKeydown}
                />
                <button
                    title="Install"
                    aria-label="Install"
                    disabled={busy || !installText.trim()}
                    onclick={installFromInput}
                >
                    <span class="codicon codicon-add"></span>
                </button>
            </div>

            <div class="input-row">
                <input
                    type="text"
                    placeholder="Search repository"
                    bind:value={searchText}
                    disabled={busy || searchLoading}
                    onkeydown={onSearchKeydown}
                />
                {#if searchText}
                    <button
                        title="Clear search"
                        aria-label="Clear search"
                        disabled={busy || searchLoading}
                        onclick={clearSearch}
                    >
                        <span class="codicon codicon-close"></span>
                    </button>
                {/if}
                <button
                    title="Search"
                    aria-label="Search"
                    disabled={busy || searchLoading || !searchText.trim()}
                    onclick={searchPackages}
                >
                    <span
                        class="codicon"
                        class:codicon-search={!searchLoading}
                        class:codicon-loading={searchLoading}
                        class:spin={searchLoading}
                    ></span>
                </button>
            </div>
        </section>

        {#if searchResults.length > 0}
            <section class="search-results">
                {#each searchResults as pkg (pkg.name.toLowerCase())}
                    <div
                        class="search-result"
                        role="button"
                        tabindex="0"
                        onclick={() => selectPackage(pkg)}
                        onkeydown={(event) => selectPackageFromKeyboard(event, pkg)}
                    >
                        <span class="result-text">
                            <span class="result-name">{pkg.displayName || pkg.name}</span>
                            <span class="result-version">{pkg.version}</span>
                        </span>
                        <span class="result-actions">
                            {#if installedPackageNames.has(pkg.name.toLowerCase())}
                                <span class="installed-label">Installed</span>
                            {:else}
                                <button
                                    title="Install"
                                    aria-label={`Install ${pkg.name}`}
                                    disabled={busy}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        void installPackage(pkg);
                                    }}
                                >
                                    <span class="codicon codicon-add"></span>
                                </button>
                            {/if}
                        </span>
                    </div>
                {/each}
            </section>
        {/if}

        <section class="list-header">
            <div class="package-count">
                <span>{filteredPackages.length}</span>
                <span>installed</span>
                {#if outdatedCount > 0}
                    <span class="outdated-count">{outdatedCount} outdated</span>
                {/if}
            </div>
            <button
                title="Update all"
                aria-label="Update all"
                disabled={busy}
                onclick={updateAllPackages}
            >
                <span class="codicon codicon-cloud-download"></span>
            </button>
        </section>

        <div class="filter-row">
            <span class="codicon codicon-filter"></span>
            <input type="text" placeholder={localize("packages.filter", "Filter packages")} bind:value={filterText} oninput={clearSelection} />
            <button class:active={parsedFilter.outdated} aria-pressed={parsedFilter.outdated}
                title={localize("packages.outdated", "Outdated packages")} aria-label={localize("packages.outdated", "Outdated packages")}
                onclick={() => toggleFilter("outdated")}><span class="codicon codicon-arrow-up"></span></button>
            <button class:active={parsedFilter.attached} aria-pressed={parsedFilter.attached}
                title={localize("packages.attached", "Attached packages")} aria-label={localize("packages.attached", "Attached packages")}
                onclick={() => toggleFilter("attached")}><span class="codicon codicon-plug"></span></button>
            <button title={parsedFilter.descending ? localize("packages.sortAscending", "Sort by name (A-Z)") : localize("packages.sortDescending", "Sort by name (Z-A)")}
                aria-label={parsedFilter.descending ? localize("packages.sortAscending", "Sort by name (A-Z)") : localize("packages.sortDescending", "Sort by name (Z-A)")}
                onclick={toggleSort}><span class="codicon codicon-sort-precedence"></span></button>
        </div>

        <section class="package-list" class:row-mode={itemSize === "row"}>
            {#if filteredPackages.length === 0}
                <div class="empty-state">
                    <span class="codicon codicon-package"></span>
                    <span>{filterText.trim() ? localize("packages.noMatches", "No matching packages") : localize("packages.empty", "No packages")}</span>
                </div>
            {:else}
                {#each filteredPackages as pkg (pkg.name.toLowerCase())}
                    <div
                        class="package-item"
                        class:selected={selectedPackage === pkg.name}
                        class:attached={pkg.attached}
                        class:outdated={pkg.outdated}
                        role="button"
                        tabindex="0"
                        onclick={() => selectPackage(pkg)}
                        onkeydown={(event) => selectPackageFromKeyboard(event, pkg)}
                    >
                        <span class="package-main">
                            <span class="package-title">
                                <span class="package-name">{pkg.displayName || pkg.name}</span>
                                {#if pkg.attached}
                                    <span class="attached-dot" title="Attached"></span>
                                {/if}
                            </span>
                            {#if itemSize === "card" && pkg.description}
                                <span class="package-description">{pkg.description}</span>
                            {/if}
                        </span>

                        <span class="package-version">
                            <span>{pkg.version}</span>
                            {#if pkg.outdated && pkg.latestVersion}
                                <span class="latest-version">{pkg.latestVersion}</span>
                            {/if}
                        </span>

                        <span class="package-actions">
                            {#if pkg.outdated}
                                <button
                                    title={localize("packages.changeVersion", "Select package version")}
                                    aria-label={`Update ${pkg.name}`}
                                    disabled={busy}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        void updatePackage(pkg);
                                    }}
                                >
                                    <span class="codicon codicon-arrow-up"></span>
                                </button>
                            {/if}
                            <button
                                title="Uninstall"
                                aria-label={`Uninstall ${pkg.name}`}
                                disabled={busy}
                                onclick={(event) => {
                                    event.stopPropagation();
                                    void uninstallPackage(pkg);
                                }}
                            >
                                <span class="codicon codicon-trash"></span>
                            </button>
                        </span>
                    </div>
                {/each}
            {/if}
        </section>
    {:else}
        <section class="empty-state full">
            <span class="codicon codicon-package"></span>
            <span>No active package session</span>
        </section>
    {/if}
</main>
