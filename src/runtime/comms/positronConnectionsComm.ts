import * as vscode from 'vscode';
import type { RuntimeClientInstance } from '../RuntimeClientInstance';
import { PositronBaseComm, type PositronCommOptions } from './positronBaseComm';

export interface ConnectionObjectSchema {
    readonly name: string;
    readonly kind: string;
    readonly has_children?: boolean;
}

export interface ConnectionFieldSchema {
    readonly name: string;
    readonly dtype: string;
}

export interface ConnectionMetadata {
    readonly name: string;
    readonly language_id: string;
    readonly host?: string;
    readonly type?: string;
    readonly code?: string;
}

export enum ConnectionsBackendRequest {
    ListObjects = 'list_objects',
    ListFields = 'list_fields',
    ContainsData = 'contains_data',
    GetIcon = 'get_icon',
    PreviewObject = 'preview_object',
    GetMetadata = 'get_metadata',
}

/** Runtime `positron.connection` protocol wrapper. */
export class PositronConnectionsComm extends PositronBaseComm {
    readonly onDidFocus: vscode.Event<Record<string, never>>;
    readonly onDidUpdate: vscode.Event<Record<string, never>>;

    constructor(
        readonly runtimeClient: RuntimeClientInstance,
        options?: PositronCommOptions<ConnectionsBackendRequest>,
    ) {
        super(runtimeClient, options);
        this.onDidFocus = this.createEventEmitter('focus', []);
        this.onDidUpdate = this.createEventEmitter('update', []);
    }

    listObjects(path: readonly ConnectionObjectSchema[]): Promise<ConnectionObjectSchema[]> {
        return this.performRpc('list_objects', ['path'], [path]);
    }

    listFields(path: readonly ConnectionObjectSchema[]): Promise<ConnectionFieldSchema[]> {
        return this.performRpc('list_fields', ['path'], [path]);
    }

    containsData(path: readonly ConnectionObjectSchema[]): Promise<boolean> {
        return this.performRpc('contains_data', ['path'], [path]);
    }

    getIcon(path: readonly ConnectionObjectSchema[]): Promise<string> {
        return this.performRpc('get_icon', ['path'], [path]);
    }

    previewObject(path: readonly ConnectionObjectSchema[]): Promise<null> {
        return this.performRpc('preview_object', ['path'], [path]);
    }

    getMetadata(): Promise<ConnectionMetadata> {
        return this.performRpc('get_metadata', ['comm_id'], [this.clientId]);
    }
}
