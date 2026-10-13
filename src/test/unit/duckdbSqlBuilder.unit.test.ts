import * as assert from 'assert';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { buildWhereClause, escapeValue } from '../../services/duckdb/sqlBuilder';
import { RowFilterType, TextSearchType, type RowFilter } from '../../shared/dataExplorer';

suite('[Unit] DuckDB literal text filters', () => {
    let database: Awaited<ReturnType<typeof duckdb.createDuckDB>>;
    let connection: duckdb.DuckDBConnection;

    suiteSetup(async () => {
        database = await duckdb.createDuckDB({
            mvp: {
                mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
                mainWorker: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs'),
            },
            eh: {
                mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
                mainWorker: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs'),
            },
        }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
        await database.instantiate();
        connection = database.connect();
    });

    suiteTeardown(() => {
        connection?.close();
        database?.reset();
    });

    for (const term of ['a_b', '10%', String.raw`c:\tmp%_`, "O'Reilly_100%"]) {
        for (const searchType of [TextSearchType.Contains, TextSearchType.NotContains,
            TextSearchType.StartsWith, TextSearchType.EndsWith]) {
            for (const caseSensitive of [true, false]) {
                test(`${searchType} treats ${JSON.stringify(term)} literally (case sensitive: ${caseSensitive})`, () => {
                    const values = [term, `prefix:${term}`, `${term}:suffix`, `prefix:${term}:suffix`,
                        term.toUpperCase(), 'axb', '10extra', 'unrelated'];
                    const filter = {
                        filter_type: RowFilterType.Search,
                        column_schema: { column_name: 'value' },
                        params: { search_type: searchType, term, case_sensitive: caseSensitive },
                    } as RowFilter;
                    const clause = buildWhereClause([filter]);
                    const table = connection.query(
                        `SELECT value FROM (VALUES ${values.map(value => `(${escapeValue(value)})`).join(', ')}) t(value) ${clause}`,
                    );
                    const needle = caseSensitive ? term : term.toLowerCase();
                    const expected = values.filter(value => {
                        const text = caseSensitive ? value : value.toLowerCase();
                        switch (searchType) {
                            case TextSearchType.Contains: return text.includes(needle);
                            case TextSearchType.NotContains: return !text.includes(needle);
                            case TextSearchType.StartsWith: return text.startsWith(needle);
                            case TextSearchType.EndsWith: return text.endsWith(needle);
                        }
                    });
                    assert.deepStrictEqual(table.toArray().map(row => row.value).sort(), expected.sort());
                });
            }
        }
    }
});
