import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionLocation,
    LanguageRuntimeSessionMode,
    LanguageRuntimeStartupBehavior,
    type LanguageRuntimeMetadata,
} from '../../api';
import { RuntimeState } from '../../internal/runtimeTypes';
import { PositronNewFolderService } from '../../newFolder/positronNewFolderService';
import {
    EPHEMERAL_WORKSPACE_SESSIONS,
    RuntimeStartupService,
} from '../../runtime/runtimeStartup';
import type { SerializedSessionMetadata } from '../../runtime/runtimeSessionService';

const WORKSPACE_SESSION_LIST_KEY = 'vscode-supervisor.workspaceSessionList.v1';

function createMemento(initialEntries: Record<string, unknown> = {}): vscode.Memento {
    const store = new Map<string, unknown>(Object.entries(initialEntries));
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeContext(
    globalStateEntries: Record<string, unknown> = {},
    workspaceStateEntries: Record<string, unknown> = {},
): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(globalStateEntries),
        workspaceState: createMemento(workspaceStateEntries),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'runtime-startup-unit-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function createDeferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
}

function makeRuntimeMetadata(
    overrides: Partial<LanguageRuntimeMetadata> = {},
): LanguageRuntimeMetadata {
    return {
        runtimeId: 'r-4.4.1-test',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '0.0.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
        startupBehavior: LanguageRuntimeStartupBehavior.Manual,
        extraRuntimeData: {
            homepath: '/usr/lib/R',
            binpath: '/usr/bin/R',
        },
        ...overrides,
    };
}

function makeRuntimeProvider() {
    return {
        validateMetadata: async (metadata: unknown) => metadata,
    } as any;
}

function makeStoredSession(
    sessionId: string,
    options?: {
        lastUsed?: number;
        localWindowId?: string;
        notebookUri?: vscode.Uri;
        runtimeMetadata?: ReturnType<typeof makeRuntimeMetadata>;
        sessionMode?: LanguageRuntimeSessionMode;
        sessionName?: string;
        workingDirectory?: string;
    },
): SerializedSessionMetadata {
    const runtimeMetadata = options?.runtimeMetadata ?? makeRuntimeMetadata();
    const sessionName = options?.sessionName ?? sessionId;
    const workingDirectory = options?.workingDirectory ?? `/tmp/${sessionId}`;

    return {
        sessionName,
        runtimeMetadata,
        metadata: {
            sessionId,
            sessionName,
            sessionMode: options?.sessionMode ?? LanguageRuntimeSessionMode.Console,
            notebookUri: options?.notebookUri,
            workingDirectory,
            createdTimestamp: 1,
            startReason: 'restoreRuntimeSession',
        },
        sessionState: RuntimeState.Ready,
        workingDirectory,
        hasConsole: true,
        lastUsed: options?.lastUsed ?? 0,
        localWindowId: options?.localWindowId,
    };
}

function makeLiveSession(
    sessionId: string,
    options?: {
        created?: number;
        runtimeMetadata?: ReturnType<typeof makeRuntimeMetadata>;
        sessionName?: string;
        state?: RuntimeState;
        workingDirectory?: string;
    },
) {
    const runtimeMetadata = options?.runtimeMetadata ?? makeRuntimeMetadata();
    const sessionName = options?.sessionName ?? sessionId;
    const workingDirectory = options?.workingDirectory ?? `/tmp/${sessionId}`;

    return {
        sessionId,
        runtimeMetadata,
        sessionMetadata: {
            sessionId,
            sessionName,
            sessionMode: LanguageRuntimeSessionMode.Console,
            workingDirectory,
            createdTimestamp: options?.created ?? 0,
            startReason: 'unit-test',
        },
        dynState: {
            sessionName,
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
        },
        workingDirectory,
        state: options?.state ?? RuntimeState.Ready,
        created: options?.created ?? 0,
        onDidChangeRuntimeState: createEventStub(),
        onDidChangeWorkingDirectory: createEventStub(),
    };
}

function makeSessionManager() {
    let persistedRestoreHandler: (() => Promise<void>) | undefined;
    const sessionManager = {
        updateActiveLanguagesCalls: 0,
        isRestoringPersistedSessions: false,
        value: undefined as any,
    };

    sessionManager.value = {
        sessions: [],
        activeSession: undefined,
        activeSessionId: undefined,
        encounteredLanguages: [],
        implicitStartupSuppressed: false,
        onWillStartSession: createEventStub(),
        onDidStartRuntime: createEventStub(),
        onDidFailStartRuntime: createEventStub(),
        onDidChangeForegroundSession: createEventStub(),
        onDidDeleteRuntimeSession: createEventStub(),
        onDidUpdateSessionName: createEventStub(),
        registerPersistedSessionRestoreHandler: (handler: () => Promise<void>) => {
            persistedRestoreHandler = handler;
        },
        get isRestoringPersistedSessions() {
            return sessionManager.isRestoringPersistedSessions;
        },
        restorePersistedSessionsInBackground: async () => {
            sessionManager.isRestoringPersistedSessions = true;
            try {
                await persistedRestoreHandler?.();
            } finally {
                sessionManager.isRestoringPersistedSessions = false;
            }
        },
        updateActiveLanguages: () => {
            sessionManager.updateActiveLanguagesCalls += 1;
        },
        hasStartingOrRunningConsole: () => false,
        autoStartRuntime: async () => {
            throw new Error('autoStartRuntime should not be called in this test');
        },
        getSession: () => undefined,
        getActiveSession: () => undefined,
        deleteSession: async () => true,
        validateRuntimeSession: async () => true,
        restoreRuntimeSession: async () => undefined,
    } as any;

    return sessionManager;
}

function makeRuntimeManager() {
    return {
        getInstallations: () => [],
        getSupportedLanguageIds: () => [],
        getRuntimeProvider: () => undefined,
        getRuntime: () => undefined,
        runtimes: [],
    } as any;
}

function makeNewFolderService(
    context: vscode.ExtensionContext,
    logChannel: vscode.LogOutputChannel,
): PositronNewFolderService {
    return new PositronNewFolderService(context, logChannel);
}

suite('[Unit] runtime startup', () => {
    test('clears dismissal keys for one language or all languages', async () => {
        const context = makeContext({
            'vscode-supervisor.dismissedArchMismatch.v1.r': true,
            'vscode-supervisor.dismissedArchMismatch.v1.python': true,
            'vscode-supervisor.other': true,
        });
        const ephemeralState = createMemento();

        const startupService = new RuntimeStartupService(
            context,
            {
                getInstallations: () => [],
            } as any,
            {
                sessions: [],
                onWillStartSession: createEventStub(),
                onDidStartRuntime: createEventStub(),
                onDidFailStartRuntime: createEventStub(),
                onDidChangeForegroundSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
                onDidUpdateSessionName: createEventStub(),
                registerPersistedSessionRestoreHandler: () => undefined,
            } as any,
            makeNewFolderService(context, makeNoopLogChannel()),
            makeNoopLogChannel(),
            ephemeralState,
        );

        startupService.resetArchitectureMismatchWarning('r');
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.r'), undefined);
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.python'), true);

        startupService.resetArchitectureMismatchWarning();
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.python'), undefined);
        assert.strictEqual(context.globalState.get('vscode-supervisor.other'), true);

        startupService.dispose();
    });

    test('waits for newly registered new-folder init tasks before continuing startup', async () => {
        const context = makeContext();
        const runtimeMetadata = makeRuntimeMetadata();
        const deferredTask = createDeferred<void>();
        const localSessionManager = makeSessionManager();
        const ephemeralState = createMemento();

        const startupService = new RuntimeStartupService(
            context,
            makeRuntimeManager(),
            localSessionManager.value,
            makeNewFolderService(context, makeNoopLogChannel()),
            makeNoopLogChannel(),
            ephemeralState,
        );

        startupService.registerNewFolderInitTask(async () => {
            startupService.registerNewFolderInitTask(deferredTask.promise, {
                label: 'follow-up-task',
                affiliatedRuntimeMetadata: runtimeMetadata,
            });
        }, {
            label: 'initial-task',
        });

        let completed = false;
        const phaseReached = new Promise<void>((resolve) => {
            const disposable = startupService.onDidChangeRuntimeStartupPhase((phase) => {
                if (phase !== 'newFolderTasks') {
                    return;
                }

                disposable.dispose();
                resolve();
            });
        });
        const startupPromise = startupService.startup().then(() => {
            completed = true;
        });

        await phaseReached;
        assert.strictEqual(startupService.startupPhase, 'newFolderTasks');
        assert.strictEqual(completed, false);
        assert.strictEqual(localSessionManager.updateActiveLanguagesCalls, 1);

        deferredTask.resolve();
        await startupPromise;

        assert.strictEqual(completed, true);
        assert.strictEqual(startupService.startupPhase, 'complete');
        assert.strictEqual(localSessionManager.updateActiveLanguagesCalls, 2);
        assert.strictEqual(
            startupService.getAffiliatedRuntimeMetadata(runtimeMetadata.languageId)?.runtimeId,
            runtimeMetadata.runtimeId,
        );

        startupService.dispose();
    });

    test('waits for explicit completeDiscovery before startup resolves', async () => {
        const context = makeContext();
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const ephemeralState = createMemento();
        localSessionManager.value.hasStartingOrRunningConsole = () => true;
        const startupService = new RuntimeStartupService(
            context,
            {
                getInstallations: () => [],
                getSupportedLanguageIds: () => ['r'],
                getRuntimeProvider: () => undefined,
                getRuntime: () => undefined,
                runtimes: [makeRuntimeMetadata()],
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        const runtimeManager = {
            id: 42,
            discoverAllRuntimes: async () => undefined,
            recommendWorkspaceRuntimes: async () => [],
        };
        const registration = startupService.registerRuntimeManager(runtimeManager);

        let completed = false;
        const phaseReached = new Promise<void>((resolve) => {
            const disposable = startupService.onDidChangeRuntimeStartupPhase((phase) => {
                if (phase !== 'discovering') {
                    return;
                }

                disposable.dispose();
                resolve();
            });
        });
        const startupPromise = startupService.startup().then(() => {
            completed = true;
        });

        await phaseReached;

        assert.strictEqual(startupService.startupPhase, 'discovering');
        assert.strictEqual(completed, false);

        startupService.completeDiscovery(runtimeManager.id);
        await startupPromise;

        assert.strictEqual(startupService.startupPhase, 'complete');
        assert.strictEqual(completed, true);

        registration.dispose();
        startupService.dispose();
    });

    test('validates persisted sessions before reconnect and activates the first valid console session', async () => {
        const context = makeContext({}, {
            [WORKSPACE_SESSION_LIST_KEY]: [
                makeStoredSession('session-2', { lastUsed: 2 }),
                makeStoredSession('session-3', { lastUsed: 3 }),
                makeStoredSession('session-1', { lastUsed: 1 }),
            ],
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const runtimeProvider = makeRuntimeProvider();
        const ephemeralState = createMemento();
        const validateCalls: string[] = [];
        const restoreCalls: Array<{ sessionId: string; activate: boolean }> = [];
        const restoreFailures: Array<{ sessionId: string; message: string }> = [];

        localSessionManager.value.validateRuntimeSession = async (_runtimeMetadata: unknown, sessionId: string) => {
            validateCalls.push(sessionId);
            return sessionId !== 'session-3';
        };
        localSessionManager.value.restoreRuntimeSession = async (
            _runtimeMetadata: unknown,
            metadata: { sessionId: string },
            _sessionName: string,
            _hasConsole: boolean,
            activate: boolean,
        ) => {
            restoreCalls.push({
                sessionId: metadata.sessionId,
                activate,
            });
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => runtimeProvider,
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );
        startupService.onSessionRestoreFailure((event) => {
            restoreFailures.push({
                sessionId: event.sessionId,
                message: event.error.message,
            });
        });

        await startupService.getRestoredSessions();
        await localSessionManager.value.restorePersistedSessionsInBackground();

        assert.deepStrictEqual(validateCalls, ['session-3', 'session-2', 'session-1']);
        assert.deepStrictEqual(restoreCalls, [
            { sessionId: 'session-2', activate: true },
            { sessionId: 'session-1', activate: false },
        ]);
        assert.deepStrictEqual(restoreFailures, [
            { sessionId: 'session-3', message: 'Session is no longer available' },
        ]);
        assert.deepStrictEqual(
            ephemeralState.get<SerializedSessionMetadata[]>(
                EPHEMERAL_WORKSPACE_SESSIONS,
                [],
            )!.map((session) => session.metadata.sessionId),
            ['session-2', 'session-1'],
        );

        startupService.dispose();
    });

    test('restores newest sessions first and never activates a notebook session', async () => {
        const context = makeContext({}, {
            [WORKSPACE_SESSION_LIST_KEY]: [
                makeStoredSession('console-old', { lastUsed: 10 }),
                makeStoredSession('notebook-new', {
                    lastUsed: 30,
                    notebookUri: vscode.Uri.file('/tmp/notebook.ipynb'),
                    sessionMode: LanguageRuntimeSessionMode.Notebook,
                }),
                makeStoredSession('console-new', { lastUsed: 20 }),
            ],
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const restoreCalls: Array<{ sessionId: string; activate: boolean }> = [];
        const startupEvents: Array<{
            runtimeName: string;
            newSession: boolean;
            activate: boolean;
        }> = [];
        localSessionManager.value.restoreRuntimeSession = async (
            _runtimeMetadata: unknown,
            metadata: { sessionId: string },
            _sessionName: string,
            _hasConsole: boolean,
            activate: boolean,
        ) => {
            restoreCalls.push({ sessionId: metadata.sessionId, activate });
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => makeRuntimeProvider(),
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            createMemento(),
        );
        startupService.onWillAutoStartRuntime((event) => {
            startupEvents.push({
                runtimeName: event.runtime.runtimeName,
                newSession: event.newSession,
                activate: event.activate,
            });
        });

        await startupService.getRestoredSessions();
        await localSessionManager.value.restorePersistedSessionsInBackground();

        assert.deepStrictEqual(startupEvents, [{
            runtimeName: 'notebook-new',
            newSession: false,
            activate: true,
        }]);
        assert.deepStrictEqual(restoreCalls, [
            { sessionId: 'notebook-new', activate: false },
            { sessionId: 'console-new', activate: true },
            { sessionId: 'console-old', activate: false },
        ]);
        startupService.dispose();
    });

    test('does not mark a background affiliated runtime as used when it starts', async () => {
        const rRuntime = makeRuntimeMetadata({
            runtimeId: 'r-primary-used',
            startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
        });
        const pythonRuntime = makeRuntimeMetadata({
            runtimeId: 'python-secondary-unused',
            runtimeName: 'Python',
            languageId: 'python',
            languageName: 'Python',
            startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
        });
        const rAffiliationKey = 'vscode-supervisor.affiliatedRuntimeMetadata.v1.r';
        const pythonAffiliationKey = 'vscode-supervisor.affiliatedRuntimeMetadata.v1.python';
        const context = makeContext({}, {
            [rAffiliationKey]: {
                metadata: rRuntime,
                lastUsed: 20,
                lastStarted: 10,
            },
            [pythonAffiliationKey]: {
                metadata: pythonRuntime,
                lastUsed: 15,
                lastStarted: 10,
            },
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const onDidStartRuntime = new vscode.EventEmitter<ReturnType<typeof makeLiveSession>>();
        const onDidChangeForegroundSession = new vscode.EventEmitter<ReturnType<typeof makeLiveSession>>();
        const starts: Array<{ runtimeId: string; activate: boolean }> = [];
        const secondaryStarted = createDeferred<void>();

        localSessionManager.value.onDidStartRuntime = onDidStartRuntime.event;
        localSessionManager.value.onDidChangeForegroundSession = onDidChangeForegroundSession.event;
        localSessionManager.value.autoStartRuntime = async (
            metadata: LanguageRuntimeMetadata,
            _source: string,
            activate: boolean,
        ) => {
            starts.push({ runtimeId: metadata.runtimeId, activate });
            const session = makeLiveSession(`${metadata.runtimeId}-session`, {
                runtimeMetadata: metadata,
                created: Date.now(),
            });
            onDidStartRuntime.fire(session);
            if (activate) {
                localSessionManager.value.activeSessionId = session.sessionId;
                onDidChangeForegroundSession.fire(session);
            } else {
                secondaryStarted.resolve();
            }
            return session.sessionId;
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getSupportedLanguageIds: () => ['r', 'python'],
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            createMemento(),
        );

        await (startupService as any)._startAffiliatedLanguageRuntimes();
        await secondaryStarted.promise;
        await Promise.resolve();

        const primaryAffiliation = context.workspaceState.get<{
            lastUsed: number;
            lastStarted: number;
        }>(rAffiliationKey)!;
        const secondaryAffiliation = context.workspaceState.get<{
            lastUsed: number;
            lastStarted: number;
        }>(pythonAffiliationKey)!;
        assert.ok(primaryAffiliation.lastUsed >= primaryAffiliation.lastStarted);
        assert.strictEqual(secondaryAffiliation.lastUsed, 15);
        assert.ok(secondaryAffiliation.lastStarted > secondaryAffiliation.lastUsed);

        starts.length = 0;
        await (startupService as any)._startAffiliatedLanguageRuntimes();
        await Promise.resolve();

        assert.deepStrictEqual(starts, [
            { runtimeId: rRuntime.runtimeId, activate: true },
        ]);

        startupService.dispose();
        onDidStartRuntime.dispose();
        onDidChangeForegroundSession.dispose();
    });

    test('recommended runtimes only start immediately when their metadata requests it', async () => {
        const context = makeContext();
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const starts: Array<{ runtimeId: string; activate: boolean }> = [];
        localSessionManager.value.autoStartRuntime = async (
            metadata: LanguageRuntimeMetadata,
            _source: string,
            activate: boolean,
        ) => {
            starts.push({ runtimeId: metadata.runtimeId, activate });
        };
        const explicit = makeRuntimeMetadata({
            runtimeId: 'r-explicit',
            startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
        });
        const immediate = makeRuntimeMetadata({
            runtimeId: 'python-immediate',
            runtimeName: 'Python',
            languageId: 'python',
            languageName: 'Python',
            startupBehavior: LanguageRuntimeStartupBehavior.Immediate,
        });
        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getSupportedLanguageIds: () => ['r', 'python'],
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            createMemento(),
        );
        startupService.registerRuntimeManager({
            id: 1,
            discoverAllRuntimes: async () => undefined,
            recommendWorkspaceRuntimes: async () => [explicit, immediate],
        });

        await (startupService as any)._startRecommendedLanguageRuntimes();

        assert.deepStrictEqual(starts, [{ runtimeId: 'python-immediate', activate: false }]);
        assert.deepStrictEqual(
            startupService.getAffiliatedRuntimeMetadata('r'),
            explicit,
        );
        startupService.dispose();
    });

    test('starts the primary affiliated runtime synchronously and secondary runtimes in background', async () => {
        const rRuntime = makeRuntimeMetadata({
            runtimeId: 'r-primary',
            startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
        });
        const pythonRuntime = makeRuntimeMetadata({
            runtimeId: 'python-secondary',
            runtimeName: 'Python',
            languageId: 'python',
            languageName: 'Python',
            startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
        });
        const context = makeContext({}, {
            'vscode-supervisor.affiliatedRuntimeMetadata.v1.r': {
                metadata: rRuntime,
                lastUsed: 20,
                lastStarted: 10,
            },
            'vscode-supervisor.affiliatedRuntimeMetadata.v1.python': {
                metadata: pythonRuntime,
                lastUsed: 15,
                lastStarted: 10,
            },
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const starts: Array<{ runtimeId: string; activate: boolean }> = [];
        const secondaryStarted = createDeferred<void>();
        localSessionManager.value.autoStartRuntime = async (
            metadata: LanguageRuntimeMetadata,
            _source: string,
            activate: boolean,
        ) => {
            starts.push({ runtimeId: metadata.runtimeId, activate });
            if (metadata.runtimeId === pythonRuntime.runtimeId) {
                secondaryStarted.resolve();
            }
        };
        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getSupportedLanguageIds: () => ['r', 'python'],
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            createMemento(),
        );

        await (startupService as any)._startAffiliatedLanguageRuntimes();
        await secondaryStarted.promise;

        assert.deepStrictEqual(starts, [
            { runtimeId: 'r-primary', activate: true },
            { runtimeId: 'python-secondary', activate: false },
        ]);
        startupService.dispose();
    });

    test('drops failed restored sessions from persistence and deletes partially restored runtime sessions', async () => {
        const context = makeContext({}, {
            [WORKSPACE_SESSION_LIST_KEY]: [
                makeStoredSession('session-failed', { lastUsed: 2 }),
                makeStoredSession('session-ok', { lastUsed: 1 }),
            ],
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const runtimeProvider = makeRuntimeProvider();
        const deletedSessionIds: string[] = [];
        const ephemeralState = createMemento();

        localSessionManager.value.getSession = (sessionId: string) => {
            return sessionId === 'session-failed'
                ? ({ sessionId } as any)
                : undefined;
        };
        localSessionManager.value.deleteSession = async (sessionId: string) => {
            deletedSessionIds.push(sessionId);
            return true;
        };
        localSessionManager.value.restoreRuntimeSession = async (
            _runtimeMetadata: unknown,
            metadata: { sessionId: string },
        ) => {
            if (metadata.sessionId === 'session-failed') {
                throw new Error('reconnect exploded');
            }
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => runtimeProvider,
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        await startupService.getRestoredSessions();
        await localSessionManager.value.restorePersistedSessionsInBackground();

        assert.deepStrictEqual(deletedSessionIds, ['session-failed']);
        assert.deepStrictEqual(
            ephemeralState.get<SerializedSessionMetadata[]>(
                EPHEMERAL_WORKSPACE_SESSIONS,
                [],
            )!.map((session) => session.metadata.sessionId),
            ['session-ok'],
        );

        startupService.dispose();
    });

    test('preserves same-window restored sessions that have not finished reconnecting', async () => {
        const storedSessions = [
            makeStoredSession('session-1', { lastUsed: 2 }),
            makeStoredSession('session-2', { lastUsed: 1 }),
        ];
        const context = makeContext({}, {
            [WORKSPACE_SESSION_LIST_KEY]: storedSessions,
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const runtimeProvider = makeRuntimeProvider();
        const liveSession = makeLiveSession('session-1', { created: 10 });
        const ephemeralState = createMemento();

        localSessionManager.value.sessions = [liveSession];
        localSessionManager.value.activeSessionId = 'session-1';
        localSessionManager.value.getSession = (sessionId: string) => {
            return sessionId === liveSession.sessionId ? liveSession : undefined;
        };
        localSessionManager.value.getActiveSession = (sessionId: string) => {
            return sessionId === liveSession.sessionId
                ? { hasConsole: true }
                : undefined;
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => runtimeProvider,
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        await startupService.getRestoredSessions();
        localSessionManager.isRestoringPersistedSessions = true;
        await (startupService as any).saveWorkspaceSessions();
        localSessionManager.isRestoringPersistedSessions = false;

        const persistedSessions = ephemeralState.get<SerializedSessionMetadata[]>(
            EPHEMERAL_WORKSPACE_SESSIONS,
            [],
        )!;
        assert.deepStrictEqual(
            persistedSessions.map((session) => session.metadata.sessionId),
            ['session-1', 'session-2'],
        );
        assert.strictEqual(
            persistedSessions.find((session) => session.metadata.sessionId === 'session-2')?.workingDirectory,
            '/tmp/session-2',
        );

        startupService.dispose();
    });

    test('does not persist sessions that are already exiting', async () => {
        const context = makeContext();
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const runtimeProvider = makeRuntimeProvider();
        const ephemeralState = createMemento();
        const readySession = makeLiveSession('session-ready', {
            created: 10,
            state: RuntimeState.Ready,
        });
        const exitingSession = makeLiveSession('session-exiting', {
            created: 20,
            state: RuntimeState.Exiting,
        });

        localSessionManager.value.sessions = [readySession, exitingSession];
        localSessionManager.value.activeSessionId = readySession.sessionId;
        localSessionManager.value.getSession = (sessionId: string) => {
            if (sessionId === readySession.sessionId) {
                return readySession;
            }

            if (sessionId === exitingSession.sessionId) {
                return exitingSession;
            }

            return undefined;
        };
        localSessionManager.value.getActiveSession = (sessionId: string) => {
            if (sessionId === readySession.sessionId || sessionId === exitingSession.sessionId) {
                return { hasConsole: true };
            }

            return undefined;
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => runtimeProvider,
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        await startupService.prepareForExtensionHostShutdown();

        const persistedSessions = ephemeralState.get<SerializedSessionMetadata[]>(
            EPHEMERAL_WORKSPACE_SESSIONS,
            [],
        )!;
        assert.deepStrictEqual(
            persistedSessions.map((session) => session.metadata.sessionId),
            ['session-ready'],
        );

        startupService.dispose();
    });

    test('preserves sessions owned by other windows when saving workspace sessions', async () => {
        const context = makeContext({}, {
            [WORKSPACE_SESSION_LIST_KEY]: [
                makeStoredSession('session-remote', {
                    lastUsed: 5,
                    localWindowId: 'window-other',
                }),
            ],
        });
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const runtimeProvider = makeRuntimeProvider();
        const liveSession = makeLiveSession('session-local', { created: 10 });
        const ephemeralState = createMemento();

        localSessionManager.value.sessions = [liveSession];
        localSessionManager.value.activeSessionId = 'session-local';
        localSessionManager.value.getSession = (sessionId: string) => {
            return sessionId === liveSession.sessionId ? liveSession : undefined;
        };
        localSessionManager.value.getActiveSession = (sessionId: string) => {
            return sessionId === liveSession.sessionId
                ? { hasConsole: true }
                : undefined;
        };

        const startupService = new RuntimeStartupService(
            context,
            {
                ...makeRuntimeManager(),
                getRuntimeProvider: () => runtimeProvider,
            } as any,
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        await startupService.getRestoredSessions();
        await (startupService as any).saveWorkspaceSessions();

        const persistedSessions = ephemeralState.get<SerializedSessionMetadata[]>(
            EPHEMERAL_WORKSPACE_SESSIONS,
            [],
        )!;
        assert.deepStrictEqual(
            persistedSessions.map((session) => session.metadata.sessionId),
            ['session-local', 'session-remote'],
        );

        startupService.dispose();
    });

    test('routes Workspace, Machine, and Browser sessions to the correct lifetime tier', async () => {
        const context = makeContext();
        const ephemeralState = createMemento();
        const logChannel = makeNoopLogChannel();
        const localSessionManager = makeSessionManager();
        const workspaceSession = makeLiveSession('session-workspace', {
            runtimeMetadata: {
                ...makeRuntimeMetadata(),
                sessionLocation: LanguageRuntimeSessionLocation.Workspace,
            },
        });
        const machineSession = makeLiveSession('session-machine', {
            runtimeMetadata: {
                ...makeRuntimeMetadata(),
                runtimeId: 'r-machine',
                sessionLocation: LanguageRuntimeSessionLocation.Machine,
            },
        });
        const browserSession = makeLiveSession('session-browser', {
            runtimeMetadata: {
                ...makeRuntimeMetadata(),
                runtimeId: 'r-browser',
                sessionLocation: LanguageRuntimeSessionLocation.Browser,
            },
        });
        localSessionManager.value.sessions = [
            workspaceSession,
            machineSession,
            browserSession,
        ];
        localSessionManager.value.getActiveSession = () => ({ hasConsole: true });

        const startupService = new RuntimeStartupService(
            context,
            makeRuntimeManager(),
            localSessionManager.value,
            makeNewFolderService(context, logChannel),
            logChannel,
            ephemeralState,
        );

        await startupService.prepareForExtensionHostShutdown();

        const ephemeralSessions = ephemeralState.get<SerializedSessionMetadata[]>(
            EPHEMERAL_WORKSPACE_SESSIONS,
            [],
        );
        const persistentSessions = context.workspaceState.get<SerializedSessionMetadata[]>(
            WORKSPACE_SESSION_LIST_KEY,
            [],
        );
        assert.deepStrictEqual(
            ephemeralSessions.map(session => session.metadata.sessionId),
            ['session-workspace'],
        );
        assert.deepStrictEqual(
            persistentSessions.map(session => session.metadata.sessionId),
            ['session-machine'],
        );
        assert.ok(
            ![...ephemeralSessions, ...persistentSessions]
                .some(session => session.metadata.sessionId === 'session-browser'),
        );

        startupService.dispose();
    });

    test('notifies about crashes even when the session was not automatically restarted', async () => {
        const context = makeContext();
        const logChannel = makeNoopLogChannel();
        const startupService = new RuntimeStartupService(
            context,
            makeRuntimeManager(),
            makeSessionManager().value,
            makeNewFolderService(context, logChannel),
            logChannel,
            createMemento(),
        );
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        let warning = '';
        let showOutputCalls = 0;
        (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage })
            .showWarningMessage = (async (message: string) => {
                warning = message;
                return 'Open Kernel Log';
            }) as typeof vscode.window.showWarningMessage;
        try {
            await (startupService as any)._notifySessionCrash({
                runtimeMetadata: makeRuntimeMetadata(),
                showOutput: () => { showOutputCalls++; },
            }, 137, false);
        } finally {
            (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage })
                .showWarningMessage = originalShowWarningMessage;
        }

        assert.match(warning, /was not automatically restarted/);
        assert.match(warning, /137/);
        assert.strictEqual(showOutputCalls, 1);
        startupService.dispose();
    });
});
