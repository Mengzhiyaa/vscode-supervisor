/**
 * Copies DuckDB WASM assets from node_modules to dist/duckdb/.
 * Replaces the CopyWebpackPlugin functionality from the webpack config.
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const duckdbDist = resolve(projectRoot, 'node_modules/@duckdb/duckdb-wasm/dist');
const outDir = resolve(projectRoot, 'dist/duckdb');

const assets = [
	'duckdb-eh.wasm',
	'duckdb-mvp.wasm',
	'duckdb-node-eh.worker.cjs',
	'duckdb-node-eh.worker.cjs.map',
	'duckdb-node-mvp.worker.cjs',
	'duckdb-node-mvp.worker.cjs.map',
	'duckdb-node.cjs',
	'duckdb-node.cjs.map',
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const asset of assets) {
	const src = resolve(duckdbDist, asset);
	if (!existsSync(src)) {
		console.warn(`[copy-duckdb] WARNING: asset not found: ${asset}`);
		continue;
	}
	copyFileSync(src, resolve(outDir, basename(asset)));
	copied++;
}

console.log(`[copy-duckdb] copied ${copied}/${assets.length} assets to dist/duckdb/`);
