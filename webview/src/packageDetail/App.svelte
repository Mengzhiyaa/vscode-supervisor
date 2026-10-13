<script lang="ts">
    import { onMount } from 'svelte';
    import type { MessageConnection } from 'vscode-jsonrpc/browser';
    import type { PackageDetailAction, PackageDetailState } from '@shared/packages';
    import { getRpcConnection } from '$lib/rpc/client';
    import { localize } from '$lib/localization';

    let connection: MessageConnection | undefined;
    let detailState = $state<PackageDetailState>();
    let pending = $state(false);
    let operationError = $state<string>();
    let selectedTab = $state<'overview' | 'security'>('overview');
    const pkg = $derived(detailState?.package);
    const disabled = $derived(!detailState?.sessionAlive || !detailState.isActive || detailState.busy || pending);
    const vulnerabilities = $derived(pkg?.vulnerabilities === undefined ? undefined :
        [...pkg.vulnerabilities].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)));
    const activeTab = $derived(selectedTab === 'security' && vulnerabilities !== undefined ? 'security' : 'overview');

    function applyState(next: PackageDetailState): void {
        if (!detailState || next.revision >= detailState.revision) detailState = next;
    }

    function formatDate(value: string): string {
        const prefix = /^(\d{4}-\d{2}-\d{2})/.exec(value);
        if (prefix) return prefix[1];
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
    }

    function isWebUrl(value: string | undefined): value is string {
        if (!value) return false;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }

    async function runAction(action: PackageDetailAction): Promise<void> {
        if (!connection || disabled) return;
        pending = true;
        operationError = undefined;
        try {
            applyState(await connection.sendRequest('packageDetail/action', { action }) as PackageDetailState);
        } catch (error) {
            operationError = error instanceof Error ? error.message : String(error);
        } finally {
            pending = false;
        }
    }

    async function openExternal(url: string): Promise<void> {
        try {
            await connection?.sendRequest('packageDetail/openExternal', { url });
        } catch (error) {
            operationError = error instanceof Error ? error.message : String(error);
        }
    }

    function onTabKeydown(event: KeyboardEvent): void {
        const tabs = vulnerabilities === undefined ? ['overview'] as const : ['overview', 'security'] as const;
        const index = tabs.findIndex(tab => tab === activeTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined;
        if (next === undefined) return;
        event.preventDefault();
        selectedTab = tabs[next];
        document.getElementById(`tab-${selectedTab}`)?.focus();
    }

    onMount(() => {
        const rpc = getRpcConnection();
        connection = rpc;
        let disposed = false;
        const listener = rpc.onNotification('packageDetail/state', (value: unknown) => applyState(value as PackageDetailState));
        void rpc.sendRequest('packageDetail/getState').then(value => {
            if (!disposed) applyState(value as PackageDetailState);
        }).catch(error => {
            if (!disposed) operationError = error instanceof Error ? error.message : String(error);
        });
        return () => {
            disposed = true;
            listener.dispose();
            connection = undefined;
        };
    });
</script>

<main class="package-detail">
    {#if operationError || detailState?.error}
        <div class="error" role="alert">{operationError || detailState?.error}</div>
    {/if}
    {#if detailState}
        <header>
            <div class="language-badge" aria-hidden="true">{detailState.languageId === 'r' ? 'R' : detailState.languageId === 'python' ? 'Py' : detailState.languageId.slice(0, 2)}</div>
            <div class="header-main">
                <div class="title-row">
                    <h1>{pkg?.displayName || detailState.packageName}</h1>
                    {#if pkg?.version}<span class="version">{pkg.version}</span>{/if}
                    {#if detailState.installed && pkg?.attached}<span class="pill">{localize('packages.detail.attached', 'Attached')}</span>{/if}
                </div>
                {#if pkg?.author}<div class="author">{pkg.author}</div>{/if}
                {#if pkg?.title || pkg?.description}<p>{pkg.title || pkg.description}</p>{/if}
                <div class="actions">
                    {#if detailState.sessionAlive}
                        {#if !detailState.installed}
                            <button class="primary" {disabled} onclick={() => runAction('install')}>{localize('packages.detail.install', 'Install')}</button>
                        {:else}
                            {#if pkg?.outdated}
                                <button class="primary" {disabled} onclick={() => runAction('update')}>{localize('packages.detail.update', 'Update')}{pkg.latestVersion ? `: ${pkg.latestVersion}` : ''}</button>
                            {/if}
                            <button {disabled} onclick={() => runAction('uninstall')}>{localize('packages.detail.uninstall', 'Uninstall')}</button>
                        {/if}
                    {/if}
                    {#if isWebUrl(pkg?.url)}
                        <button title={localize('packages.detail.website', 'Website')} onclick={() => openExternal(pkg!.url!)}><span class="codicon codicon-link-external"></span>{localize('packages.detail.website', 'Website')}</button>
                    {/if}
                    {#if detailState.sessionAlive}
                        <button {disabled} onclick={() => runAction('help')}><span class="codicon codicon-book"></span>{localize('packages.detail.help', 'Show Help')}</button>
                    {/if}
                </div>
            </div>
        </header>
        {#if !detailState.sessionAlive}
            <div class="banner">{localize('packages.detail.sessionEnded', 'This session has ended. Reopen the package after starting a new session.')}</div>
        {:else if !detailState.isActive}
            <div class="banner">{localize('packages.detail.notActive', 'Viewing {0} - not the active session', detailState.runtimeName)}</div>
        {/if}

        <div class="tabs" role="tablist" aria-label={localize('packages.detail.tabs', 'Package details')}>
            <button id="tab-overview" role="tab" aria-selected={activeTab === 'overview'} aria-controls="panel-overview"
                tabindex={activeTab === 'overview' ? 0 : -1} class:active={activeTab === 'overview'}
                onkeydown={onTabKeydown} onclick={() => selectedTab = 'overview'}>{localize('packages.detail.overview', 'Overview')}</button>
            {#if vulnerabilities !== undefined}
                <button id="tab-security" role="tab" aria-selected={activeTab === 'security'} aria-controls="panel-security"
                    tabindex={activeTab === 'security' ? 0 : -1} class:active={activeTab === 'security'}
                    onkeydown={onTabKeydown} onclick={() => selectedTab = 'security'}>{localize('packages.detail.security', 'Security')}{vulnerabilities.length ? ` (${vulnerabilities.length})` : ''}</button>
            {/if}
        </div>

        <div class="detail-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" tabindex="0" hidden={activeTab !== 'overview'}>
            {#if detailState.loading}
                <div class="loading" role="status"><span class="codicon codicon-loading spin"></span>{localize('packages.detail.loading', 'Loading package details...')}</div>
            {:else}
                <div class="stats">
                    {#if detailState.installed && pkg?.version}<div><span>{localize('packages.detail.version', 'Version')}</span><strong>{pkg.version}</strong></div>{/if}
                    {#if pkg?.license}<div><span>{localize('packages.detail.license', 'License')}</span><strong>{pkg.license}</strong></div>{/if}
                </div>
                <h2>{localize('packages.detail.metadata', 'Metadata')}</h2>
                <dl>
                    {#if pkg?.sourceRepository || pkg?.source}<dt>{localize('packages.detail.source', 'Source repository')}</dt><dd>{pkg.sourceRepository || pkg.source}</dd>{/if}
                    {#if pkg?.publishedDate}<dt>{localize('packages.detail.published', 'Date published')}</dt><dd>{formatDate(pkg.publishedDate)}</dd>{/if}
                    {#if pkg?.maintainer}<dt>{localize('packages.detail.maintainer', 'Maintainer')}</dt><dd>{pkg.maintainer}</dd>{/if}
                    <dt>{localize('packages.detail.interpreter', 'Interpreter')}</dt><dd>{detailState.runtimeName}</dd>
                </dl>
                {#if pkg?.description && pkg.description !== pkg.title}<p class="description">{pkg.description}</p>{/if}
            {/if}
        </div>
        {#if vulnerabilities !== undefined}
            <div class="detail-panel" id="panel-security" role="tabpanel" aria-labelledby="tab-security" tabindex="0" hidden={activeTab !== 'security'}>
                {#if vulnerabilities.length === 0}
                    <p>{localize('packages.detail.noAdvisories', 'No advisories were reported for this version.')}</p>
                {/if}
                {#each vulnerabilities as vulnerability}
                    <article class="advisory">
                        <div class="advisory-title">
                            {#if isWebUrl(vulnerability.url)}
                                <button class="link" onclick={() => openExternal(vulnerability.url!)}>{vulnerability.id}</button>
                            {:else}<strong>{vulnerability.id}</strong>{/if}
                            {#if vulnerability.score !== undefined}<span>CVSS {vulnerability.scoreVersion ?? ''} {vulnerability.score.toFixed(1)}</span>{/if}
                        </div>
                        {#if vulnerability.summary}<p>{vulnerability.summary}</p>{/if}
                        {#if vulnerability.fixedIn}<p>{localize('packages.detail.fixedIn', 'Fixed in {0}', vulnerability.fixedIn)}</p>{/if}
                        {#if vulnerability.published}<p>{localize('packages.detail.advisoryPublished', 'Published {0}', formatDate(vulnerability.published))}</p>{/if}
                    </article>
                {/each}
            </div>
        {/if}
    {:else}
        <div class="loading" role="status">{localize('packages.detail.loading', 'Loading package details...')}</div>
    {/if}
</main>
