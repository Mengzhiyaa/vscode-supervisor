import { createHash, randomUUID } from 'crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SerializedConsoleState } from '../../shared/consoleState';

const SchemaVersion = 3;
const JournalCompactionRecordLimit = 100;
const JournalCompactionBytesLimit = 1024 * 1024;

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

interface RecoveryManifestTombstone {
    generation: string;
    revision: number;
    deletedAt: number;
}

interface RecoveryManifest {
    schemaVersion: typeof SchemaVersion;
    activeSessionId?: string;
    sessions: Record<string, RecoveryManifestSession>;
    tombstones: Record<string, RecoveryManifestTombstone>;
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
 * File-backed v3 Console checkpoints. Files live with the Remote Extension
 * Host, so loading or retaining a large transcript does not cross the Webview
 * transport. Memento remains a small compatibility/fallback store.
 */
export class ConsoleRecoveryFileStore {
    private readonly _root: string | undefined;
    private readonly _states = new Map<string, SerializedConsoleState>();
    private _manifest: RecoveryManifest = {
        schemaVersion: SchemaVersion,
        sessions: {},
        tombstones: {},
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
                tombstones: parsed.tombstones && typeof parsed.tombstones === 'object'
                    ? parsed.tombstones
                    : {},
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this._logChannel.warn(`[ConsoleRecovery] Ignoring invalid manifest: ${error}`);
            }
            return;
        }

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
            } catch (error) {
                this._logChannel.warn(
                    `[ConsoleRecovery] Failed to load checkpoint for ${entry.sessionId}: ${error}`,
                );
            }
        }));
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

    async write(sessionId: string, state: SerializedConsoleState): Promise<void> {
        if (!this._root) {
            return;
        }

        const keyHash = createHash('sha256').update(sessionId).digest('hex');
        const sessionDirectory = path.join(this._sessionsRoot(), keyHash);
        await mkdir(sessionDirectory, { recursive: true });

        const generation = state.generation ?? 'legacy';
        const generationHash = createHash('sha256')
            .update(generation)
            .digest('hex')
            .slice(0, 16);
        const revision = state.revision ?? 0;
        const tombstone = this._manifest.tombstones[sessionId];
        if (tombstone && tombstone.generation === generation && revision <= tombstone.revision) {
            // A stale writer from before delete/clear must not resurrect the
            // deleted generation. A new generation is allowed to recreate the
            // session and clears the tombstone below.
            return;
        }
        const previous = this._manifest.sessions[sessionId];
        const serialized = JSON.stringify(state);

        // The first snapshot (or a generation change) is a checkpoint. Later
        // revisions append to a journal and are compacted periodically.
        const canJournal = previous &&
            previous.generation === generation &&
            revision > (previous.revision ?? previous.checkpointRevision ?? 0);
        if (canJournal) {
            const journal = await this._appendJournal(
                sessionId,
                sessionDirectory,
                generation,
                revision,
                state,
                previous,
            );
            this._manifest.sessions[sessionId] = {
                ...previous,
                revision,
                journal,
                updatedAt: Date.now(),
            };
            this._states.set(sessionId, state);
            delete this._manifest.tombstones[sessionId];
            if (
                journal.recordCount < JournalCompactionRecordLimit &&
                journal.byteLength < JournalCompactionBytesLimit
            ) {
                await this._writeManifest();
                return;
            }

            await this._compactSession(sessionId, state, previous, journal);
            return;
        }

        const fileName = `checkpoint-${generationHash}-${revision}-${randomUUID()}.json`;
        const relativeFile = path.relative(this._root, path.join(sessionDirectory, fileName));
        await this._atomicWrite(path.join(this._root, relativeFile), serialized);
        this._manifest.sessions[sessionId] = {
            sessionId,
            file: relativeFile,
            generation,
            revision,
            checkpointRevision: revision,
            byteLength: Buffer.byteLength(serialized, 'utf8'),
            checksum: createHash('sha256').update(serialized, 'utf8').digest('hex'),
            updatedAt: Date.now(),
        };
        delete this._manifest.tombstones[sessionId];
        await this._writeManifest();
        this._states.set(sessionId, state);

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
        const previousGeneration = previous?.generation ?? 'legacy';
        const previousRevision = previous?.revision ?? 0;
        delete this._manifest.sessions[sessionId];
        this._manifest.tombstones[sessionId] = {
            generation: previousGeneration,
            revision: previousRevision,
            deletedAt: Date.now(),
        };
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

    private async _appendJournal(
        sessionId: string,
        sessionDirectory: string,
        generation: string,
        revision: number,
        state: SerializedConsoleState,
        previous: RecoveryManifestSession,
    ): Promise<NonNullable<RecoveryManifestSession['journal']>> {
        const journalFile = previous.journal?.file ??
            path.relative(
                this._root!,
                path.join(sessionDirectory, `journal-${randomUUID()}.ndjson`),
            );
        const recordWithoutChecksum = {
            schemaVersion: SchemaVersion as typeof SchemaVersion,
            generation,
            revision,
            timestamp: Date.now(),
            state,
        };
        const serializedRecord = JSON.stringify({
            ...recordWithoutChecksum,
            checksum: createHash('sha256')
                .update(JSON.stringify(recordWithoutChecksum), 'utf8')
                .digest('hex'),
        } satisfies RecoveryJournalRecord) + '\n';
        const journalPath = this._resolveRelativeFile(journalFile);
        await appendFile(journalPath, serializedRecord, 'utf8');
        const previousJournal = previous.journal;
        return {
            file: journalFile,
            fromRevision: previousJournal?.fromRevision ?? revision,
            toRevision: revision,
            byteLength: (previousJournal?.byteLength ?? 0) + Buffer.byteLength(serializedRecord, 'utf8'),
            recordCount: (previousJournal?.recordCount ?? 0) + 1,
        };
    }

    private async _compactSession(
        sessionId: string,
        state: SerializedConsoleState,
        previous: RecoveryManifestSession,
        journal: NonNullable<RecoveryManifestSession['journal']>,
    ): Promise<void> {
        const generationHash = createHash('sha256')
            .update(state.generation ?? 'legacy')
            .digest('hex')
            .slice(0, 16);
        const sessionDirectory = path.dirname(this._resolveRelativeFile(previous.file));
        const fileName = `checkpoint-${generationHash}-${state.revision ?? 0}-${randomUUID()}.json`;
        const relativeFile = path.relative(this._root!, path.join(sessionDirectory, fileName));
        const serialized = JSON.stringify(state);
        await this._atomicWrite(path.join(this._root!, relativeFile), serialized);
        this._manifest.sessions[sessionId] = {
            ...previous,
            file: relativeFile,
            revision: state.revision ?? 0,
            checkpointRevision: state.revision ?? 0,
            byteLength: Buffer.byteLength(serialized, 'utf8'),
            checksum: createHash('sha256').update(serialized, 'utf8').digest('hex'),
            journal: undefined,
            updatedAt: Date.now(),
        };
        await this._writeManifest();
        this._states.set(sessionId, state);
        await rm(this._resolveRelativeFile(journal.file), { force: true }).catch(() => undefined);
        if (previous.file && previous.file !== relativeFile) {
            await rm(this._resolveRelativeFile(previous.file), { force: true }).catch(() => undefined);
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
