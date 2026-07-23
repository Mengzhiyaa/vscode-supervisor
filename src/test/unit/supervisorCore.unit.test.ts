import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionMode,
    type IRuntimeSessionMetadata,
    type LanguageRuntimeMetadata,
    type Utf8Location,
} from '../../api';
import {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from '../../internal/runtimeTypes';
import { RuntimeSession } from '../../runtime/session';
import { DapComm } from '../../supervisor/DapComm';
import { KCApi } from '../../supervisor/KallichoreAdapterApi';
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

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
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
    test('internal DAP sessions do not save open editors before attaching', async () => {
        const comm = {
            id: 'dap-comm-1',
            dispose: () => undefined,
        };
        const session = {
            createServerComm: async () => [comm, 5678],
            emitJupyterLog: () => undefined,
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
                        output: 'libR.so: cannot open shared object file',
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
                metadata: { source: 'unit-test' },
            },
        );

        assert.strictEqual(capturedCodeLocation?.uri.toString(), 'file:///workspace/example.R');
        assert.deepStrictEqual(capturedCodeLocation?.range, {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 0 },
        });
        assert.deepStrictEqual(capturedMetadata, { source: 'unit-test' });

        await session.dispose();
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
            { source: 'unit-test' },
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
            executionMetadata: { source: 'unit-test' },
        });
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
});
