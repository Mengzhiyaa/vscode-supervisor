/*---------------------------------------------------------------------------------------------
 *  Type declarations for @duckdb/duckdb-wasm Node.js entry point
 *  The package exports types only from the browser entry by default.
 *  This declaration re-exports the Node.js-specific types.
 *--------------------------------------------------------------------------------------------*/

declare module '@duckdb/duckdb-wasm/dist/duckdb-node' {
    export * from '@duckdb/duckdb-wasm';
}
