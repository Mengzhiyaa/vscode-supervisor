import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import {
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    type SurfaceAttachmentLease,
    type SurfaceModelSnapshot,
} from './surfaceLifecycleService';

interface NotebookAttachment {
    readonly notebookUri: string;
    readonly lease: SurfaceAttachmentLease;
}

/**
 * Connects runtime-owned models to open notebook output surfaces.
 *
 * The notebook owns presentation only. Closing a notebook releases leases but
 * leaves retained models and their runtime owners intact.
 */
export class NotebookSurfaceLifecycle implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _attachments = new Map<string, NotebookAttachment>();
    private _initialized = false;

    constructor(
        private readonly _lifecycle: SurfaceLifecycleService,
        private readonly _sessionManager: RuntimeSessionService,
    ) { }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        this._disposables.push(
            this._lifecycle.onDidChange(event => {
                if (event.type === 'disposed') {
                    this._attachments.delete(event.model.id);
                    return;
                }
                if (event.type === 'created' || event.type === 'restored' || event.type === 'updated') {
                    this._reconcileModel(event.model);
                }
            }),
            vscode.workspace.onDidOpenNotebookDocument(document => this._reconcileNotebook(document.uri)),
            vscode.workspace.onDidCloseNotebookDocument(document => this._detachNotebook(document.uri)),
            this._sessionManager.onDidCreateSession(() => this._reconcileAll()),
            this._sessionManager.onDidUpdateNotebookSessionUri(event => {
                this._detachNotebook(event.oldUri);
                this._reconcileNotebook(event.newUri);
            }),
        );

        this._reconcileAll();
    }

    private _reconcileAll(): void {
        this._lifecycle.getModels().forEach(model => this._reconcileModel(model));
    }

    private _reconcileNotebook(notebookUri: vscode.Uri): void {
        const uri = notebookUri.toString();
        this._lifecycle.getModels().forEach(model => {
            const session = this._sessionForModel(model);
            if (session?.sessionMetadata.notebookUri?.toString() === uri) {
                this._reconcileModel(model);
            }
        });
    }

    private _reconcileModel(model: SurfaceModelSnapshot): void {
        if (
            model.kind !== SurfaceModelKind.Plot &&
            model.kind !== SurfaceModelKind.Viewer
        ) {
            return;
        }

        const session = this._sessionForModel(model);
        const notebookUri = session?.sessionMetadata.notebookUri;
        const isNotebook = session?.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook;
        const isOpen = !!notebookUri && vscode.workspace.notebookDocuments.some(
            document => document.uri.toString() === notebookUri.toString(),
        );
        if (!isNotebook || !notebookUri || !isOpen) {
            this._attachments.get(model.id)?.lease.dispose();
            this._attachments.delete(model.id);
            return;
        }

        const uri = notebookUri.toString();
        const existing = this._attachments.get(model.id);
        if (existing?.notebookUri === uri) {
            return;
        }
        existing?.lease.dispose();

        const executionId = typeof model.payload.executionId === 'string'
            ? model.payload.executionId
            : undefined;
        const lease = this._lifecycle.attach(model.id, {
            surfaceId: `notebook-output:${encodeURIComponent(uri)}:${model.id}`,
            kind: SurfaceKind.NotebookCell,
            ownerId: 'notebook-surface-lifecycle',
            metadata: {
                notebookUri: uri,
                executionId,
                outputId: model.outputId,
            },
        });
        this._attachments.set(model.id, { notebookUri: uri, lease });
    }

    private _sessionForModel(model: SurfaceModelSnapshot) {
        const sessionId = model.source.sessionId;
        return sessionId
            ? this._sessionManager.sessions.find(session => session.sessionId === sessionId)
            : undefined;
    }

    private _detachNotebook(notebookUri: vscode.Uri): void {
        const uri = notebookUri.toString();
        for (const [modelId, attachment] of [...this._attachments]) {
            if (attachment.notebookUri === uri) {
                attachment.lease.dispose();
                this._attachments.delete(modelId);
            }
        }
    }

    dispose(): void {
        this._attachments.forEach(attachment => attachment.lease.dispose());
        this._attachments.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
