/*---------------------------------------------------------------------------------------------
 *  Stable DuckDB relation reads, aligned with Positron's duckdbReadPlan.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { DuckDBInstance } from './duckdbInstance';
import { escapeIdentifier as quoteIdentifier } from './sqlBuilder';

type IDuckDBQueryClient = Pick<DuckDBInstance, 'query'>;

/** A relation and a total row order shared by paging, sorting and indexed exports. */
export interface IDuckDBReadPlan {
    readonly rowOrder: string;
    relation(token?: vscode.CancellationToken): Promise<string>;
    dispose(): Promise<void>;
}

/**
 * Base tables can be scanned directly. Views and tables whose own rowid column
 * hides DuckDB's physical rowid need a snapshot with a stable ordering key.
 */
export function createDuckDBReadPlan(
    client: IDuckDBQueryClient,
    tableRef: string,
    kind: 'table' | 'view',
    columnNames: readonly string[],
): IDuckDBReadPlan {
    return kind === 'table' && !shadowsRowId(columnNames)
        ? new DirectRead(tableRef)
        : new SnapshotRead(client, tableRef, columnNames);
}

function shadowsRowId(columnNames: readonly string[]): boolean {
    return columnNames.some((name) => name.toLowerCase() === 'rowid');
}

class DirectRead implements IDuckDBReadPlan {
    readonly rowOrder = 'rowid';

    constructor(private readonly _tableRef: string) {}

    async relation(): Promise<string> {
        return this._tableRef;
    }

    async dispose(): Promise<void> {}
}

let snapshotCount = 0;
const SNAPSHOT_ORDER_COLUMN = '__positron_row_order';

class SnapshotRead implements IDuckDBReadPlan {
    readonly rowOrder: string;
    private readonly _quotedName: string;
    private readonly _qualifiedName: string;
    private readonly _selectList: string;
    private _materialized: Promise<string> | undefined;
    private _disposed = false;

    constructor(
        private readonly _client: IDuckDBQueryClient,
        private readonly _viewRef: string,
        sourceColumns: readonly string[],
    ) {
        this._quotedName = quoteIdentifier(`positron_snapshot_${++snapshotCount}`);
        this._qualifiedName = `temp.${this._quotedName}`;
        if (shadowsRowId(sourceColumns)) {
            const names = new Set(sourceColumns.map((name) => name.toLowerCase()));
            let orderColumn = SNAPSHOT_ORDER_COLUMN;
            while (names.has(orderColumn.toLowerCase())) {
                orderColumn += '_';
            }
            const ordinal = quoteIdentifier(orderColumn);
            this.rowOrder = ordinal;
            this._selectList = `ROW_NUMBER() OVER () AS ${ordinal}, *`;
        } else {
            this.rowOrder = 'rowid';
            this._selectList = '*';
        }
    }

    relation(token?: vscode.CancellationToken): Promise<string> {
        if (this._disposed) {
            return Promise.reject(new Error('Cannot read through a disposed DuckDB read plan'));
        }
        return (this._materialized ??= this._materialize(token));
    }

    private async _materialize(token?: vscode.CancellationToken): Promise<string> {
        try {
            await this._client.query(
                `CREATE TEMP TABLE ${this._quotedName} AS ` +
                    `SELECT ${this._selectList} FROM ${this._viewRef}`,
                token,
            );
            return this._qualifiedName;
        } catch (error) {
            this._materialized = undefined;
            // Cancellation can arrive after CREATE succeeded but before its
            // result was delivered. Release the uniquely named snapshot too.
            await this._client
                .query(`DROP TABLE IF EXISTS ${this._qualifiedName}`)
                .catch(() => undefined);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        this._disposed = true;
        const materialized = this._materialized;
        this._materialized = undefined;
        if (!materialized) {
            return;
        }
        try {
            await materialized;
            await this._client.query(`DROP TABLE IF EXISTS ${this._qualifiedName}`);
        } catch {
            // A terminated DuckDB connection has already released its temp catalog.
        }
    }
}
