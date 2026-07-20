import * as vscode from 'vscode';
import { RuntimeOutputKind } from '../../internal/runtimeTypes';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import type { RuntimeSession } from '../../runtime/session';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import {
    RichOutputRouter,
    RuntimeOutputConsumers,
    type RichOutputRouteRecord,
} from '../../runtime/richOutputRouter';
import { getPositronCompatibilityCapabilities } from '../../supervisor/positron';
import {
    SurfaceLifecycleService,
    type SurfaceAttachmentSnapshot,
    type SurfaceModelSnapshot,
} from '../surfaces/surfaceLifecycleService';

type DiagnosticNode =
    | { kind: 'session'; session: RuntimeSession }
    | { kind: 'clients'; session: RuntimeSession }
    | { kind: 'client'; session: RuntimeSession; clientId: string; clientType: string }
    | { kind: 'routes'; session: RuntimeSession }
    | { kind: 'route'; record: RichOutputRouteRecord }
    | { kind: 'consumer-contract' }
    | { kind: 'consumer'; outputKind: RuntimeOutputKind }
    | { kind: 'surface-models' }
    | { kind: 'surface-model'; model: SurfaceModelSnapshot }
    | { kind: 'surface-attachment'; attachment: SurfaceAttachmentSnapshot }
    | { kind: 'compatibility' }
    | { kind: 'capability'; label: string; value: string };

function routeIcon(status: RichOutputRouteRecord['status']): vscode.ThemeIcon {
    switch (status) {
        case 'routed':
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        case 'fallback':
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        case 'failed':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
    }
}

/** Read-only session/client/output routing diagnostics for P0 supportability. */
export class RuntimeSessionsTreeProvider implements vscode.TreeDataProvider<DiagnosticNode>, vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _sessionDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _onDidChangeTreeDataEmitter = new vscode.EventEmitter<DiagnosticNode | undefined>();

    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _richOutputRouter: RichOutputRouter,
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
    ) {
        this._disposables.push(
            this._onDidChangeTreeDataEmitter,
            this._sessionManager.onDidCreateSession(session => {
                this._watchSession(session);
                this.refresh();
            }),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
                this._unwatchSession(sessionId);
                this.refresh();
            }),
            this._sessionManager.onDidChangeRuntimeState(() => this.refresh()),
            this._sessionManager.onDidUpdateSessionName(() => this.refresh()),
            this._richOutputRouter.onDidRouteOutput(() => this.refresh()),
        );
        if (this._surfaceLifecycle) {
            this._disposables.push(this._surfaceLifecycle.onDidChange(() => this.refresh()));
        }

        for (const session of this._sessionManager.sessions) {
            this._watchSession(session);
        }
    }

    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire(undefined);
    }

    getTreeItem(element: DiagnosticNode): vscode.TreeItem {
        switch (element.kind) {
            case 'session': {
                const item = new vscode.TreeItem(
                    element.session.sessionMetadata.sessionName || element.session.runtimeMetadata.runtimeName,
                    vscode.TreeItemCollapsibleState.Expanded,
                );
                item.id = `session:${element.session.sessionId}`;
                item.description = `${element.session.runtimeMetadata.languageName} · ${element.session.state}`;
                item.tooltip = [
                    `Session: ${element.session.sessionId}`,
                    `Runtime: ${element.session.runtimeMetadata.runtimeName}`,
                    `Mode: ${element.session.sessionMetadata.sessionMode}`,
                    `State: ${element.session.state}`,
                ].join('\n');
                item.iconPath = new vscode.ThemeIcon('server-process');
                item.contextValue = 'supervisor.runtimeSession';
                return item;
            }
            case 'clients': {
                const count = element.session.clientManager?.clientInstances.length ?? 0;
                const item = new vscode.TreeItem('Runtime Clients', vscode.TreeItemCollapsibleState.Collapsed);
                item.description = String(count);
                item.iconPath = new vscode.ThemeIcon('plug');
                return item;
            }
            case 'client': {
                const item = new vscode.TreeItem(element.clientType, vscode.TreeItemCollapsibleState.None);
                item.description = element.clientId;
                item.tooltip = `Client ${element.clientId}\nType: ${element.clientType}\nSession: ${element.session.sessionId}`;
                item.iconPath = new vscode.ThemeIcon('radio-tower');
                return item;
            }
            case 'routes': {
                const count = this._richOutputRouter.getRouteRecords(element.session.sessionId).length;
                const item = new vscode.TreeItem('Recent Rich Outputs', vscode.TreeItemCollapsibleState.Collapsed);
                item.description = String(count);
                item.iconPath = new vscode.ThemeIcon('output');
                return item;
            }
            case 'route': {
                const item = new vscode.TreeItem(element.record.kind, vscode.TreeItemCollapsibleState.None);
                item.description = `${element.record.status} → ${element.record.consumer}`;
                item.tooltip = [
                    `Message: ${element.record.messageId}`,
                    `Output: ${element.record.outputId ?? '<none>'}`,
                    `Consumer: ${element.record.consumer}`,
                    `Status: ${element.record.status}`,
                    element.record.detail ? `Detail: ${element.record.detail}` : undefined,
                ].filter((line): line is string => !!line).join('\n');
                item.iconPath = routeIcon(element.record.status);
                return item;
            }
            case 'consumer-contract': {
                const item = new vscode.TreeItem('Output Consumer Contract', vscode.TreeItemCollapsibleState.Collapsed);
                item.description = `${Object.values(RuntimeOutputKind).length} kinds`;
                item.iconPath = new vscode.ThemeIcon('symbol-interface');
                return item;
            }
            case 'consumer': {
                const consumers = RuntimeOutputConsumers[element.outputKind];
                const item = new vscode.TreeItem(element.outputKind, vscode.TreeItemCollapsibleState.None);
                item.description = consumers.join(', ');
                item.tooltip = `${element.outputKind} → ${consumers.join(', ')}`;
                item.iconPath = new vscode.ThemeIcon(consumers.length > 0 ? 'pass' : 'error');
                return item;
            }
            case 'surface-models': {
                const count = this._surfaceLifecycle?.getModels().length ?? 0;
                const item = new vscode.TreeItem('Surface Models', vscode.TreeItemCollapsibleState.Collapsed);
                item.description = String(count);
                item.tooltip = 'Surface-neutral models and their current UI attachments';
                item.iconPath = new vscode.ThemeIcon('layers');
                return item;
            }
            case 'surface-model': {
                const item = new vscode.TreeItem(
                    element.model.title || element.model.resourceId,
                    element.model.attachments.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None,
                );
                item.description = `${element.model.kind} · ${element.model.state} · v${element.model.version}`;
                item.tooltip = [
                    `Model: ${element.model.id}`,
                    `Resource: ${element.model.resourceId}`,
                    `Source: ${element.model.source.kind}:${element.model.source.id}`,
                    `Session: ${element.model.source.sessionId ?? '<none>'}`,
                    `Retention: ${element.model.retention}`,
                    `Can stop: ${element.model.canStop}`,
                    `Attachments: ${element.model.attachments.length}`,
                ].join('\n');
                item.iconPath = new vscode.ThemeIcon(
                    element.model.state === 'attached' ? 'link' : 'circle-outline',
                );
                return item;
            }
            case 'surface-attachment': {
                const item = new vscode.TreeItem(element.attachment.kind, vscode.TreeItemCollapsibleState.None);
                item.description = element.attachment.surfaceId;
                item.tooltip = [
                    `Attachment: ${element.attachment.id}`,
                    `Surface: ${element.attachment.surfaceId}`,
                    `Owner: ${element.attachment.ownerId}`,
                ].join('\n');
                item.iconPath = new vscode.ThemeIcon('link');
                return item;
            }
            case 'compatibility': {
                const item = new vscode.TreeItem('Positron Compatibility', vscode.TreeItemCollapsibleState.Collapsed);
                item.iconPath = new vscode.ThemeIcon('shield');
                return item;
            }
            case 'capability': {
                const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
                item.description = element.value;
                item.iconPath = new vscode.ThemeIcon(
                    element.value === 'false' ? 'error' : element.value.includes('subset') ? 'warning' : 'pass'
                );
                return item;
            }
        }
    }

    getChildren(element?: DiagnosticNode): DiagnosticNode[] {
        if (!element) {
            return [
                ...this._sessionManager.sessions.map(session => ({ kind: 'session', session } as const)),
                { kind: 'consumer-contract' },
                { kind: 'surface-models' },
                { kind: 'compatibility' },
            ];
        }

        switch (element.kind) {
            case 'session':
                return [
                    { kind: 'clients', session: element.session },
                    { kind: 'routes', session: element.session },
                ];
            case 'clients':
                return (element.session.clientManager?.clientInstances ?? []).map(client => ({
                    kind: 'client',
                    session: element.session,
                    clientId: client.getClientId(),
                    clientType: client.getClientType(),
                }));
            case 'routes':
                return [...this._richOutputRouter.getRouteRecords(element.session.sessionId)]
                    .reverse()
                    .slice(0, 20)
                    .map(record => ({ kind: 'route', record }));
            case 'consumer-contract':
                return Object.values(RuntimeOutputKind).map(outputKind => ({ kind: 'consumer', outputKind }));
            case 'surface-models':
                return [...(this._surfaceLifecycle?.getModels() ?? [])]
                    .sort((left, right) => right.updatedAt - left.updatedAt)
                    .map(model => ({ kind: 'surface-model', model }));
            case 'surface-model':
                return element.model.attachments.map(attachment => ({ kind: 'surface-attachment', attachment }));
            case 'compatibility': {
                const capabilities = getPositronCompatibilityCapabilities();
                return Object.entries(capabilities).map(([label, value]) => ({
                    kind: 'capability',
                    label,
                    value: String(value),
                }));
            }
            default:
                return [];
        }
    }

    private _watchSession(session: RuntimeSession): void {
        if (this._sessionDisposables.has(session.sessionId)) {
            return;
        }

        const disposables: vscode.Disposable[] = [
            session.onDidChangeRuntimeState(() => this.refresh()),
            session.onDidCreateClientManager(manager => this._watchClientManager(session, manager, disposables)),
        ];
        if (session.clientManager) {
            this._watchClientManager(session, session.clientManager, disposables);
        }
        this._sessionDisposables.set(session.sessionId, disposables);
    }

    private _watchClientManager(
        _session: RuntimeSession,
        manager: RuntimeClientManager,
        disposables: vscode.Disposable[],
    ): void {
        disposables.push(
            manager.onDidCreateClientInstance(({ client }) => {
                disposables.push(client.onDidChangeClientState(() => this.refresh()));
                this.refresh();
            }),
        );
        for (const client of manager.clientInstances) {
            disposables.push(client.onDidChangeClientState(() => this.refresh()));
        }
        this.refresh();
    }

    private _unwatchSession(sessionId: string): void {
        this._sessionDisposables.get(sessionId)?.forEach(disposable => disposable.dispose());
        this._sessionDisposables.delete(sessionId);
    }

    dispose(): void {
        for (const disposables of this._sessionDisposables.values()) {
            disposables.forEach(disposable => disposable.dispose());
        }
        this._sessionDisposables.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
