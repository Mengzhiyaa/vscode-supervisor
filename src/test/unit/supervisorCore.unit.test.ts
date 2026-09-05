import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionMode,
    LanguageRuntimeStartupBehavior,
    LanguageLspState,
    type IRuntimeSessionMetadata,
    type LanguageRuntimeMetadata,
    type Utf8Location,
} from '../../api';
import {
    LanguageRuntimeMessageType,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
    RuntimeOutputKind,
    RuntimeState,
} from '../../internal/runtimeTypes';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import {
    createApplicationOwnerEpoch,
    createReloadPersistentState,
} from '../../runtime/ephemeralState';
import { DapComm } from '../../supervisor/DapComm';
import {
    KALLICHORE_STATE_KEY,
    KCApi,
    ServerStatusPollingTimeoutError,
    isReconnectTarget,
    pollServerStatusUntilReady,
    quotePowerShellArgument,
    saveServerStateToTier,
    selectServerState,
    sharesApplicationLifetime,
} from '../../supervisor/KallichoreAdapterApi';
import { KallichoreSession } from '../../supervisor/KallichoreSession';
import { AxiosError } from '../../supervisor/httpClient';
import { ExecuteRequest } from '../../supervisor/jupyter/ExecuteRequest';

function createMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
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

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'supervisor-core-unit-test',
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

function makeRuntimeMetadata(): LanguageRuntimeMetadata {
    return {
        runtimeId: 'runtime-1',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '0.0.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
        startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
    };
}

function makeSessionMetadata(): IRuntimeSessionMetadata {
    return {
        sessionId: 'session-1',
        sessionName: 'Session 1',
        sessionMode: LanguageRuntimeSessionMode.Console,
        createdTimestamp: Date.now(),
        startReason: 'unit-test',
    };
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

suite('[Unit] supervisor core backports', () => {
    test('quotes space-containing PowerShell Start-Process arguments', () => {
        assert.strictEqual(quotePowerShellArgument('--transport'), "'--transport'");
        assert.strictEqual(
            quotePowerShellArgument('C:\\Users\\Jane Doe\\supervisor.log'),
            "'\"C:\\Users\\Jane Doe\\supervisor.log\"'",
        );
        assert.strictEqual(
            quotePowerShellArgument("C:\\Users\\O'Brien Doe\\supervisor.log"),
            "'\"C:\\Users\\O''Brien Doe\\supervisor.log\"'",
        );
    });

    test('uses ephemeral reconnect state only for non-reconnect-target supervisors', async () => {
        assert.strictEqual(
            sharesApplicationLifetime(vscode.UIKind.Desktop, 'immediately'),
            true,
        );
        assert.strictEqual(
            isReconnectTarget(vscode.UIKind.Desktop, 'immediately'),
            false,
        );
        assert.strictEqual(
            isReconnectTarget(vscode.UIKind.Desktop, 'when idle'),
            false,
        );
        assert.strictEqual(
            isReconnectTarget(vscode.UIKind.Desktop, '4'),
            true,
        );
        assert.strictEqual(
            isReconnectTarget(vscode.UIKind.Web, 'immediately'),
            true,
        );

        const ephemeral = createMemento();
        const persistent = createMemento();
        const state = {
            base_path: 'http://127.0.0.1:9000',
            bearer_token: 'secret',
            server_pid: 42,
        } as any;

        await saveServerStateToTier(true, ephemeral, persistent, state);
        assert.strictEqual(ephemeral.get(KALLICHORE_STATE_KEY), state);
        assert.strictEqual(persistent.get(KALLICHORE_STATE_KEY), undefined);
        assert.strictEqual(selectServerState(true, state, undefined), state);

        await saveServerStateToTier(false, ephemeral, persistent, state);
        assert.strictEqual(ephemeral.get(KALLICHORE_STATE_KEY), undefined);
        assert.strictEqual(persistent.get(KALLICHORE_STATE_KEY), state);
        assert.strictEqual(selectServerState(false, undefined, state), state);
    });

    test('reload reconnect state survives a replacement extension host in the same application epoch', async () => {
        const workspaceState = createMemento();
        const ownerEpoch = 'application-epoch-1';
        const firstExtensionHostState = createReloadPersistentState(
            workspaceState,
            ownerEpoch,
        );
        const state = {
            base_path: 'http://127.0.0.1:9000',
            bearer_token: 'secret',
            server_pid: 42,
        } as any;

        await saveServerStateToTier(
            true,
            firstExtensionHostState,
            workspaceState,
            state,
        );

        const replacementExtensionHostState = createReloadPersistentState(
            workspaceState,
            ownerEpoch,
        );
        assert.deepStrictEqual(
            replacementExtensionHostState.get(KALLICHORE_STATE_KEY),
            state,
        );
        assert.strictEqual(workspaceState.get(KALLICHORE_STATE_KEY), undefined);
        assert.deepStrictEqual(replacementExtensionHostState.keys(), [KALLICHORE_STATE_KEY]);
    });

    test('reload reconnect state expires across application epochs', async () => {
        const workspaceState = createMemento();
        const firstApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-1',
        );
        await firstApplicationState.update(KALLICHORE_STATE_KEY, { server_pid: 42 });

        const nextApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-2',
        );
        assert.strictEqual(nextApplicationState.get(KALLICHORE_STATE_KEY), undefined);
        assert.deepStrictEqual(nextApplicationState.keys(), []);

        await new Promise<void>((resolve) => queueMicrotask(resolve));
        assert.deepStrictEqual(workspaceState.keys(), []);
    });

    test('stale cleanup does not remove a current-epoch replacement', async () => {
        const workspaceState = createMemento();
        const firstApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-1',
        );
        await firstApplicationState.update(KALLICHORE_STATE_KEY, { server_pid: 42 });

        const nextApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-2',
        );
        assert.strictEqual(nextApplicationState.get(KALLICHORE_STATE_KEY), undefined);
        await nextApplicationState.update(KALLICHORE_STATE_KEY, { server_pid: 43 });

        await new Promise<void>((resolve) => queueMicrotask(resolve));
        assert.deepStrictEqual(
            nextApplicationState.get(KALLICHORE_STATE_KEY),
            { server_pid: 43 },
        );
    });

    test('reload reconnect state rejects and removes the legacy unscoped format', async () => {
        const workspaceState = createMemento();
        const legacyStorageKey =
            `vscode-supervisor.reloadState.v1.${KALLICHORE_STATE_KEY}`;
        await workspaceState.update(legacyStorageKey, { server_pid: 42 });

        const reloadState = createReloadPersistentState(
            workspaceState,
            'application-epoch-1',
        );
        assert.strictEqual(reloadState.get(KALLICHORE_STATE_KEY), undefined);
        assert.strictEqual(reloadState.get('missing', 'fallback'), 'fallback');

        await new Promise<void>((resolve) => queueMicrotask(resolve));
        assert.deepStrictEqual(workspaceState.keys(), []);
    });

    test('persistent reconnect tier survives an application epoch change', async () => {
        const workspaceState = createMemento();
        const firstApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-1',
        );
        const persistentState = createMemento();
        const state = {
            base_path: 'http://127.0.0.1:9000',
            bearer_token: 'secret',
            server_pid: 42,
        } as any;
        await saveServerStateToTier(
            false,
            firstApplicationState,
            persistentState,
            state,
        );

        const nextApplicationState = createReloadPersistentState(
            workspaceState,
            'application-epoch-2',
        );
        assert.deepStrictEqual(
            selectServerState(
                false,
                nextApplicationState.get(KALLICHORE_STATE_KEY),
                persistentState.get(KALLICHORE_STATE_KEY),
            ),
            state,
        );
    });

    test('application owner epoch is stable for one VS Code process and changes across launches', () => {
        const first = createApplicationOwnerEpoch({
            VSCODE_PID: '100',
            VSCODE_IPC_HOOK: '/tmp/vscode-100.sock',
        });
        assert.strictEqual(
            createApplicationOwnerEpoch({
                VSCODE_PID: '100',
                VSCODE_IPC_HOOK: '/tmp/vscode-100.sock',
            }),
            first,
        );
        assert.notStrictEqual(
            createApplicationOwnerEpoch({
                VSCODE_PID: '101',
                VSCODE_IPC_HOOK: '/tmp/vscode-101.sock',
            }),
            first,
        );
        assert.ok(!first.includes('/tmp/vscode-100.sock'));
    });
    test('internal DAP sessions do not save open editors before attaching', async () => {
        const comm = {
            id: 'dap-comm-1',
            dispose: () => undefined,
        };
        const session = {
            createServerComm: async () => [comm, 5678],
            emitJupyterLog: () => undefined,
            metadata: { sessionId: 'runtime-session-1' },
        };

        const dapComm = await DapComm.create(
            session as any,
            'ark_dap',
            'ark',
            'Ark VS Code R',
        );

        assert.strictEqual(
            (dapComm as any).debugOptions.suppressSaveBeforeStart,
            true,
        );
        assert.strictEqual(
            (dapComm as any).debugOptions.suppressDebugView,
            undefined,
        );
        assert.strictEqual(
            (dapComm as any).config.positronRuntimeSessionId,
            'runtime-session-1',
        );

        dapComm.dispose();
    });

    test('detached startup ignores successful terminal exits during startup', () => {
        const shouldIgnore = (KCApi.prototype as any)._shouldIgnoreTerminalCloseDuringStartup;

        assert.strictEqual(
            shouldIgnore.call({}, '1 hour', { code: 0 }),
            true,
        );
        assert.strictEqual(
            shouldIgnore.call({}, '1 hour', { code: undefined }),
            true,
        );
        assert.strictEqual(
            shouldIgnore.call({}, 'immediately', { code: 0 }),
            false,
        );
        assert.strictEqual(
            shouldIgnore.call({}, '1 hour', { code: 23 }),
            false,
        );
    });

    test('server startup polling can continue past 100 attempts within the timeout', async () => {
        let now = 0;
        let attempts = 0;
        const status = await pollServerStatusUntilReady(
            async () => {
                attempts++;
                if (attempts <= 120) {
                    throw Object.assign(new Error('not ready'), { code: 'ECONNREFUSED' });
                }
                return { version: '0.1.67' };
            },
            {
                timeoutMs: 15_000,
                now: () => now,
                sleep: async (milliseconds) => {
                    now += milliseconds;
                },
            },
        );

        assert.strictEqual(attempts, 121);
        assert.deepStrictEqual(status, { version: '0.1.67' });
        assert.strictEqual(now, 12_000);
    });

    test('server startup polling stops at the configured elapsed-time deadline', async () => {
        let now = 0;
        let attempts = 0;
        await assert.rejects(
            pollServerStatusUntilReady(
                async () => {
                    attempts++;
                    throw Object.assign(new Error('not ready'), { code: 'ENOENT' });
                },
                {
                    timeoutMs: 250,
                    now: () => now,
                    sleep: async (milliseconds) => {
                        now += milliseconds;
                    },
                },
            ),
            ServerStatusPollingTimeoutError,
        );

        assert.strictEqual(attempts, 4);
        assert.strictEqual(now, 250);
    });

    test('quit shutdown is bounded and only runs for an online application-owned supervisor', async () => {
        let shutdownOptions: { timeout?: number } | undefined;
        let terminalDisposeCalls = 0;
        const ownedSupervisor = {
            serverSharesApplicationLifetime: () => true,
            _started: { isOpen: () => true },
            _api: {
                api: {
                    shutdownServer: async (options: { timeout?: number }) => {
                        shutdownOptions = options;
                    },
                },
            },
            _terminal: {
                dispose: () => {
                    terminalDisposeCalls += 1;
                },
            },
            log: () => undefined,
        };

        await KCApi.prototype.shutdownForQuit.call(ownedSupervisor as any);
        assert.deepStrictEqual(shutdownOptions, { timeout: 2000 });
        assert.strictEqual(terminalDisposeCalls, 1);
        assert.strictEqual(ownedSupervisor._terminal, undefined);

        let detachedShutdownCalls = 0;
        await KCApi.prototype.shutdownForQuit.call({
            serverSharesApplicationLifetime: () => false,
            _started: { isOpen: () => true },
            _api: { api: { shutdownServer: async () => { detachedShutdownCalls += 1; } } },
            log: () => undefined,
        } as any);
        assert.strictEqual(detachedShutdownCalls, 0);
    });

    test('waiting for terminal process id times out with a clear error', async () => {
        const waitForTerminalProcessId = (KCApi.prototype as any)._waitForTerminalProcessId;
        const fakeApi = {
            _terminal: {
                processId: new Promise<number | undefined>(() => undefined),
            },
        };

        await assert.rejects(
            waitForTerminalProcessId.call(fakeApi, 5),
            /Timed out waiting for supervisor terminal PID/,
        );
    });

    test('websocket connect retries once on connectivity errors', async () => {
        const connectWithRetry = (KallichoreSession.prototype as any)._connectWithStartupRetry;
        let attempts = 0;
        const logs: Array<{ message: string; level: vscode.LogLevel | undefined }> = [];
        const fakeSession = {
            connect: async () => {
                attempts += 1;
                if (attempts === 1) {
                    const error = new Error('connection refused') as Error & { code?: string };
                    error.code = 'ECONNREFUSED';
                    throw error;
                }
            },
            log: (message: string, level?: vscode.LogLevel) => {
                logs.push({ message, level });
            },
            _withStartupTimeout: async <T>(promise: Promise<T>): Promise<T> => promise,
            _isRetriableConnectError: (KallichoreSession.prototype as any)._isRetriableConnectError,
        };

        await connectWithRetry.call(fakeSession, 'connecting to the session websocket', 10);

        assert.strictEqual(attempts, 2);
        assert.ok(logs.some((entry) => entry.level === vscode.LogLevel.Warning));
    });

    test('startup errors preserve supervisor response diagnostics', () => {
        const createStartupError = (KallichoreSession.prototype as any)._createStartupError;
        const config = {
            method: 'post',
            url: '/sessions/session-1/start',
        };
        const cause = new AxiosError(
            'Request failed with status code 500',
            config,
            {
                status: 500,
                response: {
                    config,
                    data: {
                        error: {
                            code: 'KERNEL_START_FAILED',
                            message: 'ARK exited before opening its connection file.',
                            details: 'The configured R library could not be loaded.',
                        },
                        exit_code: 127,
                        output: 'libR.so: cannot open shared object file; --bearer-token=secret-value',
                    },
                    headers: {},
                    status: 500,
                    statusText: 'Internal Server Error',
                },
            },
        );
        const fakeSession = {
            metadata: { sessionId: 'session-1' },
            _getStartupSourceLabel: (KallichoreSession.prototype as any)._getStartupSourceLabel,
        };

        const error = createStartupError.call(
            fakeSession,
            'startSession',
            cause.message,
            cause,
        ) as Error & { details: string; exitCode?: number };

        assert.deepStrictEqual(
            {
                name: error.name,
                message: error.message,
                exitCode: error.exitCode,
                hasServerCode: error.details.includes('Server error code: KERNEL_START_FAILED'),
                hasServerDetails: error.details.includes('The configured R library could not be loaded.'),
                hasKernelOutput: error.details.includes('libR.so: cannot open shared object file'),
                redactsKernelOutput: !error.details.includes('secret-value'),
                ownsStack: error.stack?.startsWith('RuntimeStartupError: Startup failed at '),
            },
            {
                name: 'RuntimeStartupError',
                message:
                    'Startup failed at supervisor startSession API for session session-1: ' +
                    'HTTP 500 Internal Server Error for request POST /sessions/session-1/start: ' +
                    'ARK exited before opening its connection file.',
                exitCode: 127,
                hasServerCode: true,
                hasServerDetails: true,
                hasKernelOutput: true,
                redactsKernelOutput: true,
                ownsStack: true,
            },
        );
    });

    test('runtime session converts editor attribution into utf8 code locations', async () => {
        const session = new RuntimeSession(
            'session-1',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
        );

        let capturedCodeLocation: Utf8Location | undefined;
        let capturedMetadata: Record<string, unknown> | undefined;
        (session as any)._kernel = {
            execute: (
                _code: string,
                _id: string,
                _mode: RuntimeCodeExecutionMode,
                _errorBehavior: RuntimeErrorBehavior,
                codeLocation?: Utf8Location,
                executionMetadata?: Record<string, unknown>,
            ) => {
                capturedCodeLocation = codeLocation;
                capturedMetadata = executionMetadata;
            },
        };

        session.execute(
            'print(1)',
            'exec-1',
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Stop,
            {
                source: 'editor',
                fileUri: vscode.Uri.parse('file:///workspace/example.R'),
                lineNumber: 3,
                codeLocation: {
                    uri: vscode.Uri.parse('file:///workspace/example.R'),
                    range: {
                        start: { line: 2, character: 4 },
                        end: { line: 2, character: 12 },
                    },
                },
                metadata: { source: 'unit-test' },
            },
        );

        assert.strictEqual(capturedCodeLocation?.uri.toString(), 'file:///workspace/example.R');
        assert.deepStrictEqual(capturedCodeLocation?.range, {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 12 },
        });
        assert.deepStrictEqual(capturedMetadata, { source: 'unit-test' });

        await session.dispose();
    });

    test('runtime session delegates language lifecycle logs to the session supervisor', () => {
        const session = new RuntimeSession(
            'session-1',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
        );
        const calls: Array<{ message: string; level?: vscode.LogLevel }> = [];
        (session as any)._kernel = {
            emitJupyterLog: (message: string, level?: vscode.LogLevel) => calls.push({ message, level }),
        };

        session.emitLog('Starting language services', vscode.LogLevel.Debug);

        assert.deepStrictEqual(calls, [{
            message: 'Starting language services',
            level: vscode.LogLevel.Debug,
        }]);
    });

    test('runtime session lists and opens console, kernel, and LSP channels', () => {
        const session = new RuntimeSession(
            'session-1',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
            { languageId: 'r', create: () => undefined } as any,
        );
        const nativeChannels: unknown[] = [];
        let lspShows = 0;
        (session as any)._kernel = {
            listOutputChannels: () => ['console', 'kernel'],
            showOutput: (channel: unknown) => nativeChannels.push(channel),
        };
        (session as any)._lsp = { showOutput: () => { lspShows += 1; } };

        assert.deepStrictEqual(session.listOutputChannels(), ['console', 'kernel', 'lsp']);
        session.showOutput('console');
        session.showOutput('kernel');
        session.showOutput('lsp');

        assert.deepStrictEqual(nativeChannels, ['console', 'kernel']);
        assert.strictEqual(lspShows, 1);
    });

    test('kernel execute requests include positron code metadata', async () => {
        const execute = (KallichoreSession.prototype as any).execute;
        let capturedRequest: ExecuteRequest | undefined;
        const fakeSession = {
            sendRequest: async (request: ExecuteRequest) => {
                capturedRequest = request;
                return {} as unknown;
            },
            log: () => undefined,
            _toJupyterPositronLocation: (KallichoreSession.prototype as any)._toJupyterPositronLocation,
        };

        execute.call(
            fakeSession,
            'print(1)',
            'exec-1',
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Stop,
            {
                uri: vscode.Uri.parse('file:///workspace/example.R'),
                range: {
                    start: { line: 4, character: 0 },
                    end: { line: 4, character: 0 },
                },
            },
            {
                source: 'unit-test',
                cellId: 'cell-7',
            },
        );

        assert.ok(capturedRequest);
        assert.deepStrictEqual(capturedRequest?.commandPayload.positron, {
            code_location: {
                uri: 'file:///workspace/example.R',
                range: {
                    start: { line: 4, character: 0 },
                    end: { line: 4, character: 0 },
                },
            },
            source: 'unit-test',
        });
        assert.deepStrictEqual((capturedRequest as any).metadata, {
            cellId: 'cell-7',
        });
        assert.strictEqual(
            Object.prototype.hasOwnProperty.call(
                capturedRequest?.commandPayload.positron ?? {},
                'cellId',
            ),
            false,
        );
    });

    test('runtime sessions explicitly dispatch wrapped IPyWidget messages', async () => {
        const session = new RuntimeSession(
            'session-1',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
        );
        const received: any[] = [];
        const genericReceived: any[] = [];
        const listener = session.onDidReceiveRuntimeMessageIPyWidget(message => {
            received.push(message);
        });
        const genericListener = session.onDidReceiveRuntimeMessage(message => {
            genericReceived.push(message);
        });
        const originalMessage = {
            id: 'original-1',
            event_clock: 1,
            parent_id: 'exec-1',
            when: new Date(0).toISOString(),
            type: LanguageRuntimeMessageType.Output,
            kind: RuntimeOutputKind.IPyWidget,
            data: { 'text/plain': 'captured widget output' },
        };

        (session as any).processMessage({
            id: 'widget-1',
            event_clock: 2,
            parent_id: 'exec-1',
            when: new Date(0).toISOString(),
            type: LanguageRuntimeMessageType.IPyWidget,
            original_message: originalMessage,
        });

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].original_message, originalMessage);
        assert.strictEqual(genericReceived.length, 1);
        assert.strictEqual(genericReceived[0].original_message, originalMessage);
        listener.dispose();
        genericListener.dispose();
        await session.dispose();
    });

    test('resource usage emits cached process ids and fetches missing ids once', async () => {
        const emitResourceUsage = (KallichoreSession.prototype as any)._emitResourceUsage;
        const deferred = createDeferred<{ data: { process_id: number } }>();
        const emitted: Array<Record<string, unknown>> = [];
        let getSessionCalls = 0;
        const fakeSession: {
            _processId: number | undefined;
            _fetchingProcessId: boolean;
            _resourceUsage: {
                fire: (usage: Record<string, unknown>) => void;
            };
            metadata: {
                sessionId: string;
            };
            _api: {
                getSession: () => Promise<{ data: { process_id: number } }>;
            };
            _refreshProcessIdFromSession: () => Promise<void>;
        } = {
            _processId: 123,
            _fetchingProcessId: false,
            _resourceUsage: {
                fire: (usage: Record<string, unknown>) => emitted.push({ ...usage }),
            },
            metadata: {
                sessionId: 'session-1',
            },
            _api: {
                getSession: async () => {
                    getSessionCalls += 1;
                    return deferred.promise;
                },
            },
            _refreshProcessIdFromSession: (KallichoreSession.prototype as any)._refreshProcessIdFromSession,
        };

        emitResourceUsage.call(fakeSession, {
            cpu_percent: 1,
            memory_bytes: 2,
        });
        assert.strictEqual(emitted[0].process_id, 123);

        fakeSession._processId = undefined;
        emitResourceUsage.call(fakeSession, {
            cpu_percent: 3,
            memory_bytes: 4,
        });
        emitResourceUsage.call(fakeSession, {
            cpu_percent: 5,
            memory_bytes: 6,
        });
        assert.strictEqual(getSessionCalls, 1);

        deferred.resolve({ data: { process_id: 456 } });
        await deferred.promise;
        await new Promise((resolve) => setImmediate(resolve));

        assert.strictEqual(fakeSession._processId, 456);
    });

    test('activates an explicitly requested LSP even when its session is not globally foreground', async () => {
        let activated = 0;
        const lsp = {
            state: LanguageLspState.Stopped,
            activate: async () => { activated += 1; },
            deactivate: async () => undefined,
            wait: async () => true,
            showOutput: () => undefined,
            requestCompletion: async () => [],
            requestHover: async () => null,
            requestSignatureHelp: async () => null,
            dispose: () => undefined,
        };
        const session = new RuntimeSession(
            'non-foreground-lsp-session',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
        );
        (session as any)._state = RuntimeState.Ready;
        (session as any)._kernel = {
            createPositronLspClientId: () => 'lsp-client-1',
            startPositronLsp: async () => 1234,
            removeClient: () => undefined,
        };

        // The language contribution may request activation before its factory
        // is attached while restored sessions are being reconciled.
        await session.activateLsp();
        await session.attachLspFactory({ languageId: 'r', create: () => lsp });

        assert.strictEqual(activated, 1);
        assert.strictEqual((session as any)._lspRequestedActive, true);
        await session.dispose();
    });

    test('cancels a slow LSP activation when the explicit request is withdrawn', async () => {
        let resolvePort!: (port: number) => void;
        let activated = 0;
        let removedClients = 0;
        const lsp = {
            state: LanguageLspState.Stopped,
            activate: async () => { activated += 1; },
            deactivate: async () => undefined,
            wait: async () => false,
            showOutput: () => undefined,
            requestCompletion: async () => [],
            requestHover: async () => null,
            requestSignatureHelp: async () => null,
            dispose: () => undefined,
        };
        const session = new RuntimeSession(
            'slow-lsp-session',
            makeRuntimeMetadata(),
            makeSessionMetadata(),
            makeNoopLogChannel(),
            'Session 1',
            { languageId: 'r', create: () => lsp } as any,
        );
        (session as any)._state = RuntimeState.Ready;
        (session as any)._kernel = {
            createPositronLspClientId: () => 'slow-lsp-client',
            startPositronLsp: () => new Promise<number>(resolve => { resolvePort = resolve; }),
            removeClient: () => { removedClients += 1; },
        };

        const activation = session.activateLsp();
        await session.deactivateLsp();
        resolvePort(1234);
        await activation;

        assert.strictEqual(activated, 0);
        assert.strictEqual(removedClients, 1);
        assert.strictEqual((session as any)._lspRequestedActive, false);
        await session.dispose();
    });

    test('does not reconcile LSPs when the global foreground changes languages', async () => {
        const service = new RuntimeSessionService(createMemento() as any, makeNoopLogChannel()) as any;
        let oldForeground = true;
        let newForeground = false;
        let oldDeactivations = 0;
        let newActivations = 0;
        const oldSession = {
            sessionId: 'python-session',
            runtimeMetadata: { languageId: 'python' },
            sessionMetadata: { sessionMode: LanguageRuntimeSessionMode.Console },
            setForeground: (value: boolean) => { oldForeground = value; },
            deactivateLsp: async () => { oldDeactivations += 1; },
        };
        const newSession = {
            sessionId: 'r-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { sessionMode: LanguageRuntimeSessionMode.Console },
            setForeground: (value: boolean) => { newForeground = value; },
            activateLsp: async () => { newActivations += 1; },
        };
        service._sessions.set(oldSession.sessionId, oldSession);
        service._sessions.set(newSession.sessionId, newSession);
        service._foregroundSessionId = oldSession.sessionId;

        await service._setForegroundSessionInternal(newSession.sessionId);

        assert.strictEqual(oldForeground, false);
        assert.strictEqual(newForeground, true);
        assert.strictEqual(oldDeactivations, 0);
        assert.strictEqual(newActivations, 0);
        service.dispose();
    });
});
