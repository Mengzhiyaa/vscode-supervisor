import * as vscode from 'vscode';
import { CoreCommandIds, ViewContainerIds } from '../../coreCommandIds';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    type SurfaceAttachmentLease,
} from '../surfaces/surfaceLifecycleService';
import {
    type ConnectionPathEntry,
    type PositronConnectionInstance,
    type PositronConnectionNode,
    PositronConnectionsService,
} from './positronConnectionsService';

export type ConnectionsTreeNode =
    | { readonly kind: 'connection'; readonly connection: PositronConnectionInstance }
    | { readonly kind: 'object'; readonly connection: PositronConnectionInstance; readonly object: PositronConnectionNode }
    | { readonly kind: 'error'; readonly message: string };

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<ConnectionsTreeNode>, vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _surfaceAttachments = new Map<string, SurfaceAttachmentLease>();
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConnectionsTreeNode | undefined>();
    private _treeView: vscode.TreeView<ConnectionsTreeNode> | undefined;

    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly _connections: PositronConnectionsService,
        private readonly _lifecycle: SurfaceLifecycleService,
    ) {
        this._disposables.push(
            this._onDidChangeTreeData,
            this._connections.onDidChangeConnections(() => {
                this._reconcileSurfaceAttachments();
                this.refresh();
            }),
            this._connections.onDidFocusConnection(connection => void this.revealConnection(connection)),
            vscode.commands.registerCommand(CoreCommandIds.connectionsRefresh, async (node?: ConnectionsTreeNode) => {
                if (node?.kind === 'connection' || node?.kind === 'object') {
                    node.connection.refresh();
                } else {
                    this._connections.connections.forEach(connection => connection.refresh());
                }
                this.refresh();
            }),
            vscode.commands.registerCommand(CoreCommandIds.connectionsDisconnect, (node?: ConnectionsTreeNode) => {
                if (node?.kind === 'connection') {
                    node.connection.disconnect();
                }
            }),
            vscode.commands.registerCommand(CoreCommandIds.connectionsPreview, async (node?: ConnectionsTreeNode) => {
                if (node?.kind === 'object') {
                    await node.connection.preview(node.object.path);
                }
            }),
        );
    }

    bindTreeView(treeView: vscode.TreeView<ConnectionsTreeNode>): void {
        this._treeView = treeView;
        this._disposables.push(treeView.onDidChangeVisibility(() => this._reconcileSurfaceAttachments()));
        this._reconcileSurfaceAttachments();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: ConnectionsTreeNode): vscode.TreeItem {
        if (node.kind === 'error') {
            const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('error');
            item.accessibilityInformation = { label: `Connection error: ${node.message}`, role: 'treeitem' };
            return item;
        }
        if (node.kind === 'connection') {
            const item = new vscode.TreeItem(
                node.connection.metadata.name,
                node.connection.active
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
            );
            item.id = `connection:${node.connection.id}`;
            item.description = [node.connection.metadata.type, node.connection.metadata.host]
                .filter(Boolean)
                .join(' · ');
            item.tooltip = [
                `Connection: ${node.connection.metadata.name}`,
                `Language: ${node.connection.metadata.language_id}`,
                `Host: ${node.connection.metadata.host ?? '<none>'}`,
                `Type: ${node.connection.metadata.type ?? '<unknown>'}`,
                `State: ${node.connection.active ? 'connected' : 'disconnected'}`,
            ].join('\n');
            item.iconPath = new vscode.ThemeIcon(node.connection.active ? 'database' : 'debug-disconnect');
            item.contextValue = node.connection.active ? 'supervisor.connection.active' : 'supervisor.connection.inactive';
            item.accessibilityInformation = {
                label: `${node.connection.metadata.name}, ${node.connection.active ? 'connected' : 'disconnected'}${item.description ? `, ${item.description}` : ''}`,
                role: 'treeitem',
            };
            return item;
        }

        const hasChildren = node.object.kind !== 'field' && node.object.has_children !== false;
        const item = new vscode.TreeItem(
            node.object.name,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        item.id = `connection-object:${node.connection.id}:${node.object.id}`;
        item.description = node.object.dtype || node.object.kind;
        item.tooltip = `${node.object.path.map(entry => entry.name).join(' / ')}\nType: ${node.object.dtype ?? node.object.kind}`;
        item.iconPath = connectionObjectIcon(node.object.kind);
        item.contextValue = node.object.containsData
            ? 'supervisor.connectionObject.previewable'
            : 'supervisor.connectionObject';
        item.accessibilityInformation = {
            label: `${node.object.name}, ${node.object.dtype ?? node.object.kind}${node.object.containsData ? ', preview available' : ''}`,
            role: 'treeitem',
        };
        return item;
    }

    getParent(node: ConnectionsTreeNode): ConnectionsTreeNode | undefined {
        if (node.kind !== 'object') {
            return undefined;
        }
        if (node.object.path.length <= 1) {
            return { kind: 'connection', connection: node.connection };
        }
        const parentPath = node.object.path.slice(0, -1);
        const parent = parentPath[parentPath.length - 1];
        return {
            kind: 'object',
            connection: node.connection,
            object: {
                ...parent,
                id: parentPath.map(entry => `${entry.kind}:${entry.name}`).join('/'),
                path: parentPath,
                containsData: false,
            },
        };
    }

    async getChildren(node?: ConnectionsTreeNode): Promise<ConnectionsTreeNode[]> {
        if (!node) {
            return this._connections.connections.map(connection => ({ kind: 'connection', connection }));
        }
        if (node.kind === 'error') {
            return [];
        }
        if (!node.connection.active) {
            return [];
        }
        try {
            const path: readonly ConnectionPathEntry[] = node.kind === 'object' ? node.object.path : [];
            return (await node.connection.getChildren(path)).map(object => ({
                kind: 'object',
                connection: node.connection,
                object,
            }));
        } catch (error) {
            return [{ kind: 'error', message: error instanceof Error ? error.message : String(error) }];
        }
    }

    private async revealConnection(connection: PositronConnectionInstance): Promise<void> {
        await vscode.commands.executeCommand(`workbench.view.extension.${ViewContainerIds.explorationSidebar}`);
        await this._treeView?.reveal({ kind: 'connection', connection }, { focus: true, select: true, expand: true });
    }

    private _reconcileSurfaceAttachments(): void {
        if (!this._treeView?.visible) {
            this._surfaceAttachments.forEach(lease => lease.dispose());
            this._surfaceAttachments.clear();
            return;
        }
        const activeIds = new Set(this._connections.connections.map(connection => connection.id));
        for (const [connectionId, lease] of [...this._surfaceAttachments]) {
            if (!activeIds.has(connectionId)) {
                lease.dispose();
                this._surfaceAttachments.delete(connectionId);
            }
        }
        for (const connection of this._connections.connections) {
            if (this._surfaceAttachments.has(connection.id)) {
                continue;
            }
            const modelId = createSurfaceModelId(
                SurfaceModelKind.Connection,
                connection.sessionId,
                connection.clientId,
            );
            if (this._lifecycle.getModel(modelId)) {
                this._surfaceAttachments.set(connection.id, this._lifecycle.attach(modelId, {
                    surfaceId: `connections-pane:${connection.id}`,
                    kind: SurfaceKind.ConnectionsPane,
                    ownerId: 'connections-tree-provider',
                    metadata: { connectionId: connection.id },
                }));
            }
        }
    }

    dispose(): void {
        this._surfaceAttachments.forEach(lease => lease.dispose());
        this._surfaceAttachments.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}

function connectionObjectIcon(kind: string): vscode.ThemeIcon {
    switch (kind.toLowerCase()) {
        case 'database': return new vscode.ThemeIcon('database');
        case 'catalog': return new vscode.ThemeIcon('library');
        case 'schema': return new vscode.ThemeIcon('symbol-namespace');
        case 'table': return new vscode.ThemeIcon('table');
        case 'view': return new vscode.ThemeIcon('preview');
        case 'field': return new vscode.ThemeIcon('symbol-field');
        default: return new vscode.ThemeIcon('symbol-object');
    }
}
