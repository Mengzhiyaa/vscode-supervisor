/**
 * Builds self-contained DuckDB worker assets in dist/duckdb/.
 *
 * The upstream Node worker entry points contain runtime require('apache-arrow')
 * calls. The extension bundle cannot satisfy those calls from a worker thread,
 * and node_modules is intentionally excluded from the VSIX. Bundle the worker
 * entry points separately so they remain deployable without node_modules.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const defaultDuckdbDist = resolve(projectRoot, 'node_modules/@duckdb/duckdb-wasm/dist');
const defaultOutDir = resolve(projectRoot, 'dist/duckdb');

const copiedAssets = [
	'duckdb-eh.wasm',
	'duckdb-mvp.wasm',
];

const bundledAssets = [
	'duckdb-node-eh.worker.cjs',
	'duckdb-node-mvp.worker.cjs',
	'duckdb-node.cjs',
];

export async function buildDuckDBAssets({
	duckdbDist = defaultDuckdbDist,
	outDir = defaultOutDir,
} = {}) {
	mkdirSync(outDir, { recursive: true });

	let copied = 0;
	for (const asset of copiedAssets) {
		const src = resolve(duckdbDist, asset);
		if (!existsSync(src)) {
			throw new Error(`[copy-duckdb] Required asset not found: ${asset}`);
		}
		copyFileSync(src, resolve(outDir, asset));
		copied++;
	}

	let bundled = 0;
	for (const asset of bundledAssets) {
		const src = resolve(duckdbDist, asset);
		if (!existsSync(src)) {
			throw new Error(`[copy-duckdb] Required worker entry point not found: ${asset}`);
		}
		await build({
			entryPoints: [src],
			outfile: resolve(outDir, asset),
			bundle: true,
			platform: 'node',
			format: 'cjs',
			target: 'node18',
			minify: true,
			sourcemap: false,
			legalComments: 'none',
			logLevel: 'silent',
		});
		bundled++;
	}

	return { copied, bundled };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const result = await buildDuckDBAssets();
	console.log(
		`[copy-duckdb] copied ${result.copied} WASM assets and bundled ` +
		`${result.bundled} standalone worker assets in dist/duckdb/`,
	);
}
