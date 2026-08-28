import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const SchemaVersion = 1;

type HistoryKind = 'session-input' | 'language-input' | 'execution';

interface StoredHistoryFile {
    schemaVersion: typeof SchemaVersion;
    kind: HistoryKind;
    id: string;
    entries: unknown[];
}

/** File-backed history that remains local to the Extension Host. */
export class ExecutionHistoryFileStore {
    private readonly _root: string | undefined;
    private readonly _sessionInputs = new Map<string, unknown[]>();
    private readonly _languageInputs = new Map<string, unknown[]>();
    private readonly _executions = new Map<string, unknown[]>();

    constructor(
        storageUri: vscode.Uri | undefined,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._root = storageUri?.fsPath
            ? path.join(storageUri.fsPath, 'history', 'v1')
            : undefined;
    }

    get enabled(): boolean {
        return this._root !== undefined;
    }

    async initialize(): Promise<void> {
        if (!this._root) {
            return;
        }
        await Promise.all([
            mkdir(this._sessionsRoot(), { recursive: true }),
            mkdir(this._languagesRoot(), { recursive: true }),
        ]);
        await Promise.all([
            this._loadDirectory(this._sessionsRoot()),
            this._loadDirectory(this._languagesRoot()),
        ]);
    }

    getSessionInput(sessionId: string): unknown[] | undefined {
        return this._sessionInputs.get(sessionId);
    }

    getLanguageInput(languageId: string): unknown[] | undefined {
        return this._languageInputs.get(languageId);
    }

    getExecution(sessionId: string): unknown[] | undefined {
        return this._executions.get(sessionId);
    }

    async writeSessionInput(sessionId: string, entries: readonly unknown[]): Promise<void> {
        await this._write('session-input', sessionId, entries);
        this._sessionInputs.set(sessionId, [...entries]);
    }

    async writeLanguageInput(languageId: string, entries: readonly unknown[]): Promise<void> {
        await this._write('language-input', languageId, entries);
        this._languageInputs.set(languageId, [...entries]);
    }

    async writeExecution(sessionId: string, entries: readonly unknown[]): Promise<void> {
        await this._write('execution', sessionId, entries);
        this._executions.set(sessionId, [...entries]);
    }

    async deleteSessionInput(sessionId: string): Promise<void> {
        if (!this._root) {
            return;
        }
        this._sessionInputs.delete(sessionId);
        await rm(this._filePath('session-input', sessionId), { force: true });
    }

    async deleteExecution(sessionId: string): Promise<void> {
        if (!this._root) {
            return;
        }
        this._executions.delete(sessionId);
        await rm(this._filePath('execution', sessionId), { force: true });
    }

    private async _loadDirectory(directory: string): Promise<void> {
        const files = await readdir(directory, { withFileTypes: true });
        await Promise.all(files
            .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
            .map(async entry => {
                const file = path.join(directory, entry.name);
                try {
                    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredHistoryFile>;
                    if (
                        value.schemaVersion !== SchemaVersion ||
                        typeof value.id !== 'string' ||
                        !Array.isArray(value.entries) ||
                        (value.kind !== 'session-input' &&
                            value.kind !== 'language-input' &&
                            value.kind !== 'execution')
                    ) {
                        throw new Error('unsupported or malformed history file');
                    }
                    this._mapFor(value.kind).set(value.id, value.entries);
                } catch (error) {
                    this._outputChannel.warn(
                        `[ExecutionHistoryService] Ignoring invalid history file ${file}: ${error}`,
                    );
                }
            }));
    }

    private async _write(
        kind: HistoryKind,
        id: string,
        entries: readonly unknown[],
    ): Promise<void> {
        if (!this._root) {
            return;
        }
        const payload: StoredHistoryFile = {
            schemaVersion: SchemaVersion,
            kind,
            id,
            entries: [...entries],
        };
        await this._atomicWrite(this._filePath(kind, id), JSON.stringify(payload));
    }

    private async _atomicWrite(target: string, contents: string): Promise<void> {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, contents, 'utf8');
            await rename(temporary, target);
        } finally {
            await rm(temporary, { force: true }).catch(() => undefined);
        }
    }

    private _filePath(kind: HistoryKind, id: string): string {
        const name = createHash('sha256').update(id).digest('hex');
        const directory = kind === 'language-input'
            ? this._languagesRoot()
            : this._sessionsRoot();
        const suffix = kind === 'execution' ? 'execution' : 'input';
        return path.join(directory, `${name}.${suffix}.json`);
    }

    private _mapFor(kind: HistoryKind): Map<string, unknown[]> {
        switch (kind) {
            case 'session-input':
                return this._sessionInputs;
            case 'language-input':
                return this._languageInputs;
            case 'execution':
                return this._executions;
        }
    }

    private _sessionsRoot(): string {
        return path.join(this._root!, 'sessions');
    }

    private _languagesRoot(): string {
        return path.join(this._root!, 'languages');
    }
}
