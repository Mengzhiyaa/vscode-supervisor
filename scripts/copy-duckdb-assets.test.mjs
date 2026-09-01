import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as workerThreads from 'node:worker_threads';
import { buildDuckDBAssets } from './copy-duckdb-assets.mjs';

const require = createRequire(import.meta.url);
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node.cjs');

class NodeWebWorkerAdapter {
    constructor(workerBootstrapPath, workerModulePath) {
        this.worker = new workerThreads.Worker(workerBootstrapPath, {
            workerData: { mod: workerModulePath },
        });
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const wrapped = type === 'message'
            ? data => listener({ type, data })
            : type === 'error'
                ? error => listener(error)
                : code => listener({ type, code });
        const listeners = this.listeners.get(type) ?? new Map();
        listeners.set(listener, wrapped);
        this.listeners.set(type, listeners);
        this.worker.on(type === 'close' ? 'exit' : type, wrapped);
    }

    removeEventListener(type, listener) {
        const wrapped = this.listeners.get(type)?.get(listener);
        if (wrapped) {
            this.worker.off(type === 'close' ? 'exit' : type, wrapped);
        }
    }

    postMessage(message, transferList) {
        this.worker.postMessage(message, transferList);
    }

    terminate() {
        return this.worker.terminate();
    }
}

test('builds a DuckDB worker that runs without node_modules', { timeout: 30_000 }, async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'ark-duckdb-assets-'));
    let db;
    let connection;
    try {
        await buildDuckDBAssets({ outDir: outputDirectory });
        const worker = new NodeWebWorkerAdapter(
            join(outputDirectory, 'duckdb-node.cjs'),
            join(outputDirectory, 'duckdb-node-eh.worker.cjs'),
        );
        db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
        await db.instantiate(join(outputDirectory, 'duckdb-eh.wasm'));
        connection = await db.connect();
        await db.registerFileBuffer(
            'packaged.csv',
            new TextEncoder().encode('value\n1\n2\n'),
        );
        const result = await connection.query(
            `SELECT * FROM read_csv_auto('packaged.csv', header=true)`,
        );

        assert.equal(result.numRows, 2);
    } finally {
        await connection?.close();
        await db?.terminate();
        rmSync(outputDirectory, { recursive: true, force: true });
    }
});
