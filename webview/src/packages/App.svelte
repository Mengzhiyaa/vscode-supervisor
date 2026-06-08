<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { getRpcConnection } from "$lib/rpc/client";

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
        packages: PackageItem[];
        activeSession?: SessionState;
        busy: boolean;
        selectedPackage?: string;
        itemSize: "card" | "row";
    }

    let connection = $state<MessageConnection | undefined>();
    let packages = $state<PackageItem[]>([]);
    let activeSession = $state<SessionState | undefined>();
    let busy = $state(false);
    let selectedPackage = $state<string | undefined>();
    let itemSize = $state<"card" | "row">("card");
    let filterText = $state("");
    let installText = $state("");
    let searchText = $state("");
    let searchResults = $state<PackageItem[]>([]);
    let searchLoading = $state(false);
    let operationError = $state<string | undefined>();

    const filteredPackages = $derived(
        packages.filter((pkg) => {
            const query = filterText.trim().toLowerCase();
            if (!query) {
                return true;
            }
            return (
                pkg.name.toLowerCase().includes(query) ||
                pkg.displayName.toLowerCase().includes(query) ||
                (pkg.description ?? "").toLowerCase().includes(query)
            );
        }),
    );

    const installedPackageNames = $derived(
        new Set(packages.map((pkg) => pkg.name.toLowerCase())),
    );

    const outdatedCount = $derived(
        packages.filter((pkg) => pkg.outdated).length,
    );

    function applyState(state: PackagesState): void {
        packages = state.packages ?? [];
        activeSession = state.activeSession;
        busy = state.busy;
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

    async function runStateRequest(method: string, params?: unknown): Promise<void> {
        if (!connection) {
            return;
        }

        operationError = undefined;
        busy = true;
        try {
            const state = (await connection.sendRequest(
                method,
                params,
            )) as PackagesState;
            applyState(state);
        } catch (error) {
            operationError = formatError(error);
            busy = false;
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

        await runStateRequest("packages/install", { packages: specs });
        installText = "";
    }

    async function installPackage(pkg: PackageItem): Promise<void> {
        await runStateRequest("packages/install", {
            packages: [{ name: pkg.name }],
        });
    }

    async function updatePackage(pkg: PackageItem): Promise<void> {
        await runStateRequest("packages/update", {
            packages: [{ name: pkg.name }],
        });
    }

    async function uninstallPackage(pkg: PackageItem): Promise<void> {
        const confirmed = window.confirm(`Uninstall ${pkg.name}?`);
        if (!confirmed) {
            return;
        }
        await runStateRequest("packages/uninstall", {
            packageNames: [pkg.name],
        });
    }

    async function searchPackages(): Promise<void> {
        const query = searchText.trim();
        if (!query || !connection) {
            searchResults = [];
            return;
        }

        operationError = undefined;
        searchLoading = true;
        try {
            searchResults = (await connection.sendRequest("packages/search", {
                query,
            })) as PackageItem[];
        } catch (error) {
            operationError = formatError(error);
            searchResults = [];
        } finally {
            searchLoading = false;
        }
    }

    function selectPackage(pkg: PackageItem): void {
        selectedPackage = pkg.name;
        connection?.sendNotification("packages/setSelected", { name: pkg.name });
    }

    function selectPackageFromKeyboard(event: KeyboardEvent, pkg: PackageItem): void {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectPackage(pkg);
        }
    }

    function setItemSize(nextSize: "card" | "row"): void {
        itemSize = nextSize;
        connection?.sendNotification("packages/setItemSize", {
            itemSize: nextSize,
        });
    }

    function clearSearch(): void {
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
        void requestState();

        return () => {
            stateDisposable.dispose();
        };
    });

    onDestroy(() => {
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
                {#each searchResults as pkg (pkg.id || pkg.name)}
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
            <input type="text" placeholder="Filter" bind:value={filterText} />
        </div>

        <section class="package-list" class:row-mode={itemSize === "row"}>
            {#if filteredPackages.length === 0}
                <div class="empty-state">
                    <span class="codicon codicon-package"></span>
                    <span>No packages</span>
                </div>
            {:else}
                {#each filteredPackages as pkg (pkg.id || pkg.name)}
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
                                    title="Update"
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
