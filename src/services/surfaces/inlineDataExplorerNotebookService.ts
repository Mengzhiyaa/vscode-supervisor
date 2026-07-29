import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import type { IPositronDataExplorerService } from '../dataExplorer/positronDataExplorerService';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    type SurfaceAttachmentLease,
} from './surfaceLifecycleService';

export const InlineDataExplorerRendererId = 'supervisor.inlineDataExplorerRenderer';
const MAX_INLINE_REQUEST_COLUMNS = 50;
const MAX_INLINE_REQUEST_ROWS = 200;

interface RendererMessage {
    readonly type?: string;
    readonly requestId?: string;
    readonly outputId?: string;
    readonly commId?: string;
    readonly firstRow?: number;
    readonly numRows?: number;
    readonly firstColumn?: number;
    readonly numColumns?: number;
    readonly sortKeys?: Array<{
        readonly columnIndex: number;
        readonly ascending: boolean;
    }>;
}

interface InlineAttachment {
    readonly notebookUri: string;
    readonly lease: SurfaceAttachmentLease;
}

/** Bridges the notebook renderer to the existing Data Explorer backend. */
export class InlineDataExplorerNotebookService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _attachments = new Map<string, InlineAttachment>();
    private readonly _messaging: vscode.NotebookRendererMessaging;

    constructor(
        private readonly _dataExplorerService: IPositronDataExplorerService,
        private readonly _lifecycle: SurfaceLifecycleService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._messaging = vscode.notebooks.createRendererMessaging(InlineDataExplorerRendererId);
        this._disposables.push(
            this._messaging.onDidReceiveMessage(event => {
                void this._handleMessage(event.editor, event.message as RendererMessage);
            }),
            vscode.workspace.onDidCloseNotebookDocument(document => this._detachNotebook(document.uri)),
            this._dataExplorerService.onDidCloseInstance(identifier => this._detachInstance(identifier)),
        );
    }

    private async _handleMessage(editor: vscode.NotebookEditor, message: RendererMessage): Promise<void> {
        if (!message.type || !message.outputId) {
            return;
        }
        const notebookUri = editor.notebook.uri.toString();
        const surfaceId = this._surfaceId(notebookUri, message.outputId);

        if (message.type === 'inlineDataExplorer/dispose') {
            this._attachments.get(surfaceId)?.lease.dispose();
            this._attachments.delete(surfaceId);
            return;
        }
        if (!message.commId || !message.requestId) {
            return;
        }
        if (message.type === 'inlineDataExplorer/open') {
            await vscode.commands.executeCommand(CoreCommandIds.dataExplorerOpenInline, message.commId);
            return;
        }
        if (
            message.type !== 'inlineDataExplorer/load' &&
            message.type !== 'inlineDataExplorer/sort'
        ) {
            return;
        }

        try {
            const instance = await this._dataExplorerService.getInstanceAsync(message.commId, 5000);
            if (!instance) {
                throw new Error('Data Explorer backend is unavailable. Re-run the notebook cell.');
            }

            this._attach(instance.identifier, notebookUri, message.outputId);
            if (message.type === 'inlineDataExplorer/sort') {
                await instance.setSortColumns(
                    (message.sortKeys ?? []).map(sortKey => ({
                        column_index: sortKey.columnIndex,
                        ascending: sortKey.ascending,
                    })),
                );
            }
            const backend = await instance.clientInstance.getBackendState(true);
            const firstColumn = Math.max(
                0,
                Math.min(
                    Math.trunc(message.firstColumn ?? 0),
                    backend.table_shape.num_columns,
                ),
            );
            const columnCount = Math.min(
                Math.max(0, Math.trunc(message.numColumns ?? 12)),
                MAX_INLINE_REQUEST_COLUMNS,
                backend.table_shape.num_columns - firstColumn,
            );
            const firstRow = Math.max(
                0,
                Math.min(
                    Math.trunc(message.firstRow ?? 0),
                    backend.table_shape.num_rows,
                ),
            );
            const rowCount = Math.min(
                Math.max(0, Math.trunc(message.numRows ?? 60)),
                MAX_INLINE_REQUEST_ROWS,
                backend.table_shape.num_rows - firstRow,
            );
            const columnIndices = Array.from(
                { length: columnCount },
                (_, index) => firstColumn + index,
            );
            const schema = await instance.getSchema(columnIndices);
            const values = rowCount > 0
                ? await instance.clientInstance.getDataValues(columnIndices.map(columnIndex => ({
                    column_index: columnIndex,
                    spec: {
                        first_index: firstRow,
                        last_index: firstRow + rowCount - 1,
                    },
                })))
                : { columns: columnIndices.map(() => []) };
            const rowLabels =
                backend.has_row_labels && rowCount > 0
                    ? await instance.clientInstance.getRowLabels({
                          first_index: firstRow,
                          last_index: firstRow + rowCount - 1,
                      })
                    : undefined;

            await this._messaging.postMessage({
                type: 'inlineDataExplorer/data',
                requestId: message.requestId,
                commId: message.commId,
                title: backend.display_name,
                shape: {
                    rows: backend.table_shape.num_rows,
                    columns: backend.table_shape.num_columns,
                },
                firstRow,
                firstColumn,
                columnIndices,
                columns: schema.columns.map(column => ({
                    name: column.column_label || column.column_name,
                    type: column.type_name,
                })),
                values: values.columns,
                rowLabels: rowLabels?.row_labels[0],
                sortKeys: backend.sort_keys.map(sortKey => ({
                    columnIndex: sortKey.column_index,
                    ascending: sortKey.ascending,
                })),
            }, editor);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this._outputChannel.warn(`[InlineDataExplorer] ${detail}`);
            await this._messaging.postMessage({
                type: 'inlineDataExplorer/error',
                requestId: message.requestId,
                message: detail,
            }, editor);
        }
    }

    private _attach(identifier: string, notebookUri: string, outputId: string): void {
        const surfaceId = this._surfaceId(notebookUri, outputId);
        if (this._attachments.has(surfaceId)) {
            return;
        }
        const modelId = createSurfaceModelId(SurfaceModelKind.DataExplorer, identifier);
        if (!this._lifecycle.getModel(modelId)) {
            return;
        }
        const lease = this._lifecycle.attach(modelId, {
            surfaceId,
            kind: SurfaceKind.DataExplorerInline,
            ownerId: 'inline-data-explorer-notebook-renderer',
            metadata: { notebookUri, outputId, identifier },
        });
        this._attachments.set(surfaceId, { notebookUri, lease });
    }

    private _surfaceId(notebookUri: string, outputId: string): string {
        return `data-explorer-inline:${encodeURIComponent(notebookUri)}:${encodeURIComponent(outputId)}`;
    }

    private _detachNotebook(notebookUri: vscode.Uri): void {
        const uri = notebookUri.toString();
        for (const [surfaceId, attachment] of [...this._attachments]) {
            if (attachment.notebookUri === uri) {
                attachment.lease.dispose();
                this._attachments.delete(surfaceId);
            }
        }
    }

    private _detachInstance(identifier: string): void {
        for (const [surfaceId, attachment] of [...this._attachments]) {
            const model = this._lifecycle.getModel(attachment.lease.modelId);
            if (!model || model.resourceId === identifier) {
                attachment.lease.dispose();
                this._attachments.delete(surfaceId);
            }
        }
    }

    dispose(): void {
        this._attachments.forEach(attachment => attachment.lease.dispose());
        this._attachments.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
