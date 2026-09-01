/*---------------------------------------------------------------------------------------------
 *  DuckDB Instance — Singleton wrapper around @duckdb/duckdb-wasm
 *  Manages the DuckDB-WASM database lifecycle in the extension host
 *
 *  Performance-optimized (aligned with positron):
 *  - Uses EH bundle directly, skipping selectBundle() detection
 *  - Uses VoidLogger instead of ConsoleLogger
 *  - Supports eager pre-initialization via initialize()
 *--------------------------------------------------------------------------------------------*/

// Use the default @duckdb/duckdb-wasm import for types.
// At runtime, esbuild bundles duckdb-node.cjs (and apache-arrow) into extension.js.
// The WASM binaries and standalone worker bundles are produced by scripts/copy-duckdb-assets.mjs.
import type * as DuckDBTypes from '@duckdb/duckdb-wasm';
import * as path from 'path';

// The DuckDB WASM/worker files are built in dist/duckdb/ by copy-duckdb-assets.mjs.
// __dirname resolves to the dist/ folder at runtime after bundling.
const DUCKDB_BUNDLE_DIR = path.join(__dirname, 'duckdb');
const DUCKDB_INITIALIZATION_TIMEOUT_MS = 30_000;

// Dynamically load the Node.js entry of duckdb-wasm — esbuild will bundle this
// along with its apache-arrow dependency into extension.js.
 
const duckdb: typeof DuckDBTypes = require('@duckdb/duckdb-wasm/dist/duckdb-node.cjs');

// Load worker_threads using Node's native require.
// esbuild treats Node.js builtins as external automatically.
 
const workerThreads: typeof import('worker_threads') = require('worker_threads');

type DuckDBWorkerEvent = 'message' | 'error' | 'close';
type DuckDBWorkerListener = (event: unknown) => void;

/**
 * Adapts Node's Worker API to the small Web Worker surface AsyncDuckDB expects.
 *
 * We use a custom adapter because the `web-worker` polyfill cannot be used in
 * a bundled extension (node_modules are not deployed at runtime).
 * DuckDB's node worker entry is a CommonJS module and must execute inside a
 * real Node worker thread where `module`, `exports`, and `require` exist.
 */
class NodeWebWorkerAdapter {
    private readonly _worker: import('worker_threads').Worker;
    private readonly _listeners = new Map<DuckDBWorkerEvent, Map<DuckDBWorkerListener, (...args: any[]) => void>>();
    private readonly _failure: Promise<never>;
    private _rejectFailure: (error: Error) => void = () => undefined;
    private _terminating = false;

    constructor(workerBootstrapPath: string, workerModulePath: string) {
        this._failure = new Promise<never>((_resolve, reject) => {
            this._rejectFailure = reject;
        });
        // A worker can fail while idle. Mark the promise as observed here while
        // retaining its rejected state for the next guarded DuckDB operation.
        this._failure.catch(() => undefined);
        this._worker = new workerThreads.Worker(workerBootstrapPath, {
            workerData: { mod: workerModulePath },
        });
        this._worker.once('error', (error: Error) => {
            this._rejectFailure(new Error(`DuckDB worker failed: ${error.message}`, {
                cause: error,
            }));
        });
        this._worker.once('exit', code => {
            if (!this._terminating) {
                this._rejectFailure(new Error(`DuckDB worker exited unexpectedly with code ${code}.`));
            }
        });
    }

    get failure(): Promise<never> {
        return this._failure;
    }

    addEventListener(type: DuckDBWorkerEvent, listener: DuckDBWorkerListener): void {
        let wrapped = this._listeners.get(type)?.get(listener);
        if (wrapped) {
            return;
        }

        switch (type) {
            case 'message':
                wrapped = (data: unknown) => listener({ type, data });
                this._worker.on('message', wrapped);
                break;
            case 'error':
                wrapped = (error: Error) => listener(error);
                this._worker.on('error', wrapped);
                break;
            case 'close':
                wrapped = (code: number) => listener({ type, code });
                this._worker.on('exit', wrapped);
                break;
        }

        const listenersForType = this._listeners.get(type) ?? new Map();
        listenersForType.set(listener, wrapped);
        this._listeners.set(type, listenersForType);
    }

    removeEventListener(type: DuckDBWorkerEvent, listener: DuckDBWorkerListener): void {
        const listenersForType = this._listeners.get(type);
        const wrapped = listenersForType?.get(listener);
        if (!wrapped) {
            return;
        }

        switch (type) {
            case 'message':
                this._worker.off('message', wrapped);
                break;
            case 'error':
                this._worker.off('error', wrapped);
                break;
            case 'close':
                this._worker.off('exit', wrapped);
                break;
        }

        listenersForType?.delete(listener);
        if (listenersForType?.size === 0) {
            this._listeners.delete(type);
        }
    }

    postMessage(message: unknown, transferList?: readonly unknown[]): void {
        this._worker.postMessage(message, transferList as readonly import('worker_threads').TransferListItem[] | undefined);
    }

    terminate(): Promise<number> {
        this._terminating = true;
        return this._worker.terminate();
    }
}

/**
 * Singleton DuckDB-WASM instance for the extension.
 *
 * Aligned with positron's DuckDBInstance:
 * - Uses EH bundle directly (skips selectBundle detection)
 * - Uses VoidLogger to eliminate logging overhead
 * - Loads ICU extension and sets timezone to UTC
 * - Serializes queries to prevent concurrent execution issues
 * - Supports eager pre-initialization at extension activation
 */
export class DuckDBInstance {
    private static _instance: DuckDBInstance | undefined;

    private _db: DuckDBTypes.AsyncDuckDB | undefined;
    private _conn: DuckDBTypes.AsyncDuckDBConnection | undefined;
    private _worker: NodeWebWorkerAdapter | undefined;
    private _initPromise: Promise<void> | undefined;
    private _disposed = false;

    /** Promise chain to serialize concurrent queries */
    private _runningQuery: Promise<any> = Promise.resolve();

    private constructor() { }

    /**
     * Get or create the singleton instance.
     */
    static getInstance(): DuckDBInstance {
        if (!DuckDBInstance._instance) {
            DuckDBInstance._instance = new DuckDBInstance();
        }
        return DuckDBInstance._instance;
    }

    /**
     * Whether the instance is initialized and ready for queries.
     */
    get isReady(): boolean {
        return this._db !== undefined && this._conn !== undefined && !this._disposed;
    }

    /**
     * Initialize DuckDB-WASM. Safe to call multiple times — will only initialize once.
     * Can be called eagerly at extension activation to pre-warm the WASM engine.
     */
    async initialize(): Promise<void> {
        if (this._disposed) {
            throw new Error('DuckDBInstance has been disposed');
        }
        if (this.isReady) {
            return;
        }
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._doInitialize();
        try {
            await this._initPromise;
        } finally {
            this._initPromise = undefined;
        }
    }

    private async _doInitialize(): Promise<void> {
        // Use the EH (Exception Handling) bundle directly (aligned with positron).
        // In Node.js Extension Host, EH is always available — skip selectBundle() detection.
        const bundle = {
            mainModule: path.resolve(DUCKDB_BUNDLE_DIR, 'duckdb-eh.wasm'),
            mainWorker: path.resolve(DUCKDB_BUNDLE_DIR, 'duckdb-node-eh.worker.cjs'),
        };

        // Use NodeWebWorkerAdapter with bootstrap trampoline (duckdb-node.cjs loads the worker module)
        const workerBootstrapPath = path.resolve(DUCKDB_BUNDLE_DIR, 'duckdb-node.cjs');
        const worker = new NodeWebWorkerAdapter(workerBootstrapPath, bundle.mainWorker);
        this._worker = worker;

        // Use VoidLogger to eliminate logging overhead (aligned with positron)
        const logger = new duckdb.VoidLogger();

        const db = new duckdb.AsyncDuckDB(logger, worker as any);
        this._db = db;
        try {
            await this._runWorkerOperation(
                db.instantiate(bundle.mainModule),
                'initialize DuckDB-WASM',
                DUCKDB_INITIALIZATION_TIMEOUT_MS,
            );
            const conn = await this._runWorkerOperation(
                db.connect(),
                'connect to DuckDB-WASM',
                DUCKDB_INITIALIZATION_TIMEOUT_MS,
            );
            this._conn = conn;

            // Load ICU extension and set timezone to UTC (aligned with positron)
            await this._runWorkerOperation(
                conn.query(`LOAD icu; SET TIMEZONE='UTC';`),
                'configure DuckDB-WASM',
                DUCKDB_INITIALIZATION_TIMEOUT_MS,
            );
        } catch (error) {
            this._conn = undefined;
            this._db = undefined;
            this._worker = undefined;
            await db.terminate().catch(() => undefined);
            throw error;
        }
    }

    private async _runWorkerOperation<T>(
        operation: Promise<T>,
        description: string,
        timeoutMs?: number,
    ): Promise<T> {
        const worker = this._worker;
        if (!worker) {
            throw new Error(`Cannot ${description}: DuckDB worker is not available.`);
        }

        const guardedOperation = Promise.race([operation, worker.failure]);
        if (timeoutMs === undefined) {
            return guardedOperation;
        }

        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                guardedOperation,
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => {
                        reject(new Error(
                            `Timed out after ${timeoutMs}ms while attempting to ${description}.`,
                        ));
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    /**
     * Execute a SQL query and return the result as an Arrow Table.
     *
     * Queries are serialized: each query waits for the previous one to finish
     * before executing, preventing concurrent execution issues in duckdb-wasm.
     */
    async query(sql: string): Promise<any> {
        await this.initialize();
        if (!this._conn) {
            throw new Error('DuckDB connection not available');
        }

        // Serialize queries: wait for the previous one to finish
        await this._runWorkerOperation(this._runningQuery, 'wait for the previous DuckDB query');
        try {
            this._runningQuery = this._runWorkerOperation(
                this._conn.query(sql),
                'execute a DuckDB query',
            );
            const result = await this._runningQuery;
            return result;
        } catch (error) {
            // Reset the chain so subsequent queries can proceed
            this._runningQuery = Promise.resolve();
            throw error;
        }
    }

    /**
     * Register a file buffer in DuckDB's virtual filesystem.
     */
    async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
        await this.initialize();
        if (!this._db) {
            throw new Error('DuckDB not initialized');
        }
        await this._runWorkerOperation(
            this._db.registerFileBuffer(name, buffer),
            'register a file with DuckDB-WASM',
        );
    }

    /**
     * Drop a registered file buffer.
     */
    async dropFile(name: string): Promise<void> {
        if (this._db) {
            try {
                await this._runWorkerOperation(
                    this._db.dropFile(name),
                    'drop a DuckDB-WASM file',
                );
            } catch {
                // Ignore errors when dropping files that may not exist
            }
        }
    }

    /**
     * Dispose the DuckDB instance and free resources.
     */
    async dispose(): Promise<void> {
        this._disposed = true;
        await this._initPromise?.catch(() => undefined);
        if (this._conn) {
            await this._runWorkerOperation(
                this._conn.close(),
                'close the DuckDB-WASM connection',
            ).catch(() => undefined);
            this._conn = undefined;
        }
        if (this._db) {
            await this._db.terminate().catch(() => undefined);
            this._db = undefined;
        }
        this._worker = undefined;
        DuckDBInstance._instance = undefined;
    }
}
