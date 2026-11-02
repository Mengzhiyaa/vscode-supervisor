import * as assert from 'assert';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { DuckDBTableView } from '../../services/duckdb/duckdbTableView';
import {
    ColumnDisplayType,
    ExportFormat,
    TableSelectionKind,
} from '../../runtime/comms/positronDataExplorerComm';

suite('[Unit] DuckDB Data Explorer export', () => {
    let database: Awaited<ReturnType<typeof duckdb.createDuckDB>>;
    let connection: duckdb.DuckDBConnection;
    let view: DuckDBTableView;

    suiteSetup(async () => {
        database = await duckdb.createDuckDB(
            {
                mvp: {
                    mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
                    mainWorker:
                        require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs'),
                },
                eh: {
                    mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
                    mainWorker:
                        require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs'),
                },
            },
            new duckdb.VoidLogger(),
            duckdb.NODE_RUNTIME,
        );
        await database.instantiate();
        connection = database.connect();
        connection.query(
            `CREATE TABLE export_fixture (stamp TIMESTAMP, bytes BLOB, big BIGINT, text VARCHAR, huge HUGEINT)`,
        );
        connection.query(`INSERT INTO export_fixture VALUES
            (TIMESTAMP '2026-11-03 10:20:30.123456', from_hex('0102FF'), 9007199254740993, 'a,"b"', 170141183460469231731687303715884105727),
            (NULL, NULL, NULL, 'second', NULL)`);
        const schema = [
            {
                column_name: 'stamp',
                type_name: 'TIMESTAMP',
                type_display: ColumnDisplayType.Datetime,
            },
            { column_name: 'bytes', type_name: 'BLOB', type_display: ColumnDisplayType.Object },
            { column_name: 'big', type_name: 'BIGINT', type_display: ColumnDisplayType.Integer },
            { column_name: 'text', type_name: 'VARCHAR', type_display: ColumnDisplayType.String },
            { column_name: 'huge', type_name: 'HUGEINT', type_display: ColumnDisplayType.Integer },
        ].map((column, column_index) => ({ ...column, column_index }));
        // Supply a real SQL connection without importing a file or starting a worker.
        view = Object.assign(Object.create(DuckDBTableView.prototype), {
            _duckdb: { query: async (sql: string) => connection.query(sql) },
            _fullSchema: schema,
            _filteredRowCount: 2,
            _whereClause: '',
            _sortClause: '',
            readPlan: { relation: async () => 'export_fixture', rowOrder: 'rowid' },
        });
    });

    suiteTeardown(() => {
        connection?.close();
        database?.reset();
    });

    test('copies only the value of a single cell, preserving temporal and integer precision', async () => {
        const expected = [
            '2026-11-03 10:20:30.123456',
            '[BLOB 3 bytes]',
            '9007199254740993',
            'a,"b"',
            '170141183460469231731687303715884105727',
        ];
        for (const [column_index, data] of expected.entries()) {
            assert.deepStrictEqual(
                await view.exportDataSelection(
                    {
                        kind: TableSelectionKind.SingleCell,
                        selection: { row_index: 0, column_index },
                    },
                    ExportFormat.Tsv,
                ),
                { data, format: ExportFormat.Tsv },
            );
        }
        assert.strictEqual(
            (
                await view.exportDataSelection(
                    {
                        kind: TableSelectionKind.SingleCell,
                        selection: { row_index: 1, column_index: 0 },
                    },
                    ExportFormat.Tsv,
                )
            ).data,
            'NULL',
        );
    });

    test('formats wide integer grid values from exact digits across the Arrow boundary', async () => {
        const result = await view.getDataValues(
            [
                { column_index: 2, spec: { first_index: 0, last_index: 0 } },
                { column_index: 4, spec: { first_index: 0, last_index: 0 } },
            ],
            {
                large_num_digits: 2,
                small_num_digits: 4,
                max_integral_digits: 50,
                max_value_length: 1000,
                thousands_sep: '',
            },
        );
        assert.deepStrictEqual(result.columns, [
            ['9007199254740993'],
            ['170141183460469231731687303715884105727'],
        ]);
    });

    test('exports selected rows and columns in their displayed order with one header row', async () => {
        const result = await view.exportDataSelection(
            {
                kind: TableSelectionKind.CellIndices,
                selection: { row_indices: [1, 0], column_indices: [3, 2, 0, 1] },
            },
            ExportFormat.Tsv,
        );
        assert.strictEqual(
            result.data,
            [
                'text\tbig\tstamp\tbytes',
                'second\tNULL\tNULL\tNULL',
                '"a,""b"""\t9007199254740993\t2026-11-03 10:20:30.123456\t[BLOB 3 bytes]',
            ].join('\n'),
        );
    });
});
