import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SerializedConsoleState } from '../../shared/consoleState';

const SchemaVersion = 3;

interface RecoveryManifestSession {
    sessionId: string;
    file: string;
    generation: string;
    revision: number;
    byteLength: number;
    checksum?: string;
    checkpointRevision?: number;
    journal?: {
        file: string;
        fromRevision: number;
        toRevision: number;
        byteLength: number;
        recordCount: number;
    };
    updatedAt: number;
}

interface RecoveryJournalRecord {
    schemaVersion: typeof SchemaVersion;
    generation: string;
    revision: number;
    timestamp: number;
    state: SerializedConsoleState;
    checksum: string;
}

interface RecoveryManifest {
    schemaVersion: typeof SchemaVersion;
    activeSessionId?: string;
    sessions: Record<string, RecoveryManifestSession>;
}

function isSerializedConsoleState(value: unknown): value is SerializedConsoleState {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const state = value as Partial<SerializedConsoleState>;
    return (state.version === 1 || state.version === 2 || state.version === 3) &&
        Array.isArray(state.items) &&
        Array.isArray(state.inputHistory) &&
        typeof state.trace === 'boolean' &&
        typeof state.wordWrap === 'boolean';
}

/**
 * File-backed v3 Console recovery. Each session retains one latest checkpoint
 * on the Extension Host; Memento is used only when file storage is unavailable.
 */
export class ConsoleRecoveryFileStore {
    private readonly _root: string | undefined;
    private readonly _states = new Map<string, SerializedConsoleState>();
    private _manifest: RecoveryManifest = {
        schemaVersion: SchemaVersion,
        sessions: {},
    };

    constructor(
        storageUri: vscode.Uri | undefined,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        this._root = storageUri?.fsPath
            ? path.join(storageUri.fsPath, 'console-recovery', 'v3')
            : undefined;
    }

    get enabled(): boolean {
        return this._root !== undefined;
    }

    async initialize(): Promise<void> {
        if (!this._root) {
            return;
        }
        await mkdir(this._sessionsRoot(), { recursive: true });

        try {
            const parsed = JSON.parse(await readFile(this._manifestPath(), 'utf8')) as Partial<RecoveryManifest>;
            if (parsed.schemaVersion !== SchemaVersion || !parsed.sessions || typeof parsed.sessions !== 'object') {
                throw new Error('unsupported or malformed recovery manifest');
            }
            this._manifest = {
                schemaVersion: SchemaVersion,
                activeSessionId: typeof parsed.activeSessionId === 'string'
                    ? parsed.activeSessionId
                    : undefined,
                sessions: parsed.sessions,
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this._logChannel.warn(`[ConsoleRecovery] Ignoring invalid manifest: ${error}`);
            }
            return;
        }

        const journalMigrations: Array<{
            entry: RecoveryManifestSession;
            state: SerializedConsoleState;
            hash: string;
        }> = [];
        await Promise.all(Object.values(this._manifest.sessions).map(async entry => {
            try {
                const state = JSON.parse(await readFile(this._resolveRelativeFile(entry.file), 'utf8'));
                if (!isSerializedConsoleState(state)) {
                    throw new Error('invalid Console checkpoint payload');
                }
                if (entry.checksum) {
                    const checksum = createHash('sha256')
                        .update(JSON.stringify(state), 'utf8')
                        .digest('hex');
                    if (checksum !== entry.checksum) {
                        throw new Error('Console checkpoint checksum mismatch');
                    }
                }
                let recoveredState = state;
                if (entry.journal?.file) {
                    recoveredState = await this._replayJournal(
                        entry,
                        recoveredState,
                    );
                }
                this._states.set(entry.sessionId, recoveredState);
                if (entry.journal?.file) {
                    journalMigrations.push({
                        entry,
                        state: recoveredState,
                        hash: createHash('sha256')
                            .update(JSON.stringify(recoveredState), 'utf8')
                            .digest('hex'),
                    });
                }
            } catch (error) {
                this._logChannel.warn(
                    `[ConsoleRecovery] Failed to load checkpoint for ${entry.sessionId}: ${error}`,
                );
            }
        }));

        for (const migration of journalMigrations) {
            try {
                await this._writeCheckpoint(
                    migration.entry.sessionId,
                    migration.state,
                    migration.hash,
                    JSON.stringify(migration.state),
                    migration.entry,
                );
                this._logChannel.debug(
                    `[ConsoleRecovery] Migrated journal to latest checkpoint for ${migration.entry.sessionId}`,
                );
            } catch (error) {
                this._logChannel.warn(
                    `[ConsoleRecovery] Failed to migrate journal for ${migration.entry.sessionId}: ${error}`,
                );
            }
        }
    }

    get(sessionId: string): SerializedConsoleState | undefined {
        return this._states.get(sessionId);
    }

    getActiveSessionId(): string | undefined {
        return this._manifest.activeSessionId;
    }

    async setActiveSessionId(sessionId: string | undefined): Promise<void> {
        if (!this._root || this._manifest.activeSessionId === sessionId) {
            return;
        }
        this._manifest.activeSessionId = sessionId;
        await this._writeManifest();
    }

    async write(
        sessionId: string,
        state: SerializedConsoleState,
        checksum?: string,
    ): Promise<void> {
        if (!this._root) {
            return;
        }

        const serialized = JSON.stringify(state);
        const checkpointChecksum = checksum ?? createHash('sha256')
            .update(serialized, 'utf8')
            .digest('hex');
        const previous = this._manifest.sessions[sessionId];
        await this._writeCheckpoint(
            sessionId,
            state,
            checkpointChecksum,
            serialized,
            previous,
        );
    }

    private async _writeCheckpoint(
        sessionId: string,
        state: SerializedConsoleState,
        checksum: string,
        serialized: string,
        previous?: RecoveryManifestSession,
    ): Promise<void> {
        const root = this._root!;
        const keyHash = createHash('sha256').update(sessionId).digest('hex');
        const sessionDirectory = path.join(this._sessionsRoot(), keyHash);
        await mkdir(sessionDirectory, { recursive: true });

        const generation = state.generation ?? 'legacy';
        const generationHash = createHash('sha256')
            .update(generation)
            .digest('hex')
            .slice(0, 16);
        const revision = state.revision ?? 0;
        const fileName = `checkpoint-${generationHash}-${revision}-${randomUUID()}.json`;
        const relativeFile = path.relative(root, path.join(sessionDirectory, fileName));
        await this._atomicWrite(path.join(root, relativeFile), serialized);
        this._manifest.sessions[sessionId] = {
            sessionId,
            file: relativeFile,
            generation,
            revision,
            byteLength: Buffer.byteLength(serialized, 'utf8'),
            checksum,
            updatedAt: Date.now(),
        };
        await this._writeManifest();
        this._states.set(sessionId, state);
        this._logChannel.debug(
            `[ConsoleRecovery] Checkpoint ${sessionId}: ` +
            `bytes=${Buffer.byteLength(serialized, 'utf8')} revision=${revision}`,
        );

        if (previous?.file && previous.file !== relativeFile) {
            await rm(this._resolveRelativeFile(previous.file), { force: true }).catch(() => undefined);
        }
        if (previous?.journal?.file) {
            await rm(this._resolveRelativeFile(previous.journal.file), { force: true }).catch(() => undefined);
        }
    }

    async delete(sessionId: string): Promise<void> {
        if (!this._root) {
            return;
        }
        const previous = this._manifest.sessions[sessionId];
        delete this._manifest.sessions[sessionId];
        if (this._manifest.activeSessionId === sessionId) {
            this._manifest.activeSessionId = undefined;
        }
        await this._writeManifest();
        this._states.delete(sessionId);
        if (previous?.file) {
            await rm(this._resolveRelativeFile(previous.file), { force: true }).catch(() => undefined);
        }
        if (previous?.journal?.file) {
            await rm(this._resolveRelativeFile(previous.journal.file), { force: true }).catch(() => undefined);
        }
    }

    private async _replayJournal(
        entry: RecoveryManifestSession,
        checkpoint: SerializedConsoleState,
    ): Promise<SerializedConsoleState> {
        if (!entry.journal) {
            return checkpoint;
        }
        let recovered = checkpoint;
        const checkpointRevision = entry.checkpointRevision ?? checkpoint.revision ?? 0;
        try {
            const contents = await readFile(this._resolveRelativeFile(entry.journal.file), 'utf8');
            for (const line of contents.split('\n')) {
                if (!line.trim()) {
                    continue;
                }
                let parsed: RecoveryJournalRecord;
                try {
                    parsed = JSON.parse(line) as RecoveryJournalRecord;
                    const { checksum, ...withoutChecksum } = parsed;
                    const expected = createHash('sha256')
                        .update(JSON.stringify(withoutChecksum), 'utf8')
                        .digest('hex');
                    if (checksum !== expected || parsed.schemaVersion !== SchemaVersion) {
                        throw new Error('invalid journal checksum or schema');
                    }
                } catch (error) {
                    this._logChannel.warn(`[ConsoleRecovery] Ignoring invalid journal record for ${entry.sessionId}: ${error}`);
                    continue;
                }
                if (
                    parsed.generation === checkpoint.generation &&
                    parsed.revision > checkpointRevision &&
                    (!recovered.revision || parsed.revision > recovered.revision)
                ) {
                    recovered = parsed.state;
                }
            }
        } catch (error) {
            this._logChannel.warn(`[ConsoleRecovery] Failed to replay journal for ${entry.sessionId}: ${error}`);
        }
        return recovered;
    }

    private async _writeManifest(): Promise<void> {
        if (!this._root) {
            return;
        }
        await this._atomicWrite(this._manifestPath(), JSON.stringify(this._manifest));
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

    private _manifestPath(): string {
        return path.join(this._root!, 'workspace-manifest.json');
    }

    private _sessionsRoot(): string {
        return path.join(this._root!, 'sessions');
    }

    private _resolveRelativeFile(relativeFile: string): string {
        const root = path.resolve(this._root!);
        const resolved = path.resolve(root, relativeFile);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
            throw new Error('Console recovery manifest contains a path outside its storage root');
        }
        return resolved;
    }
}
