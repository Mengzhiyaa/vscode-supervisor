import { ExportFormat } from '../../shared/dataExplorer';

/** Matches Positron's conversion of raw DuckDB values before export. */
export function stringifyExportCell(value: unknown): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (value instanceof Uint8Array) {
        return `[BLOB ${value.byteLength} bytes]`;
    }
    return String(value);
}

function escapeDelimitedValue(value: string, delimiter: string): string {
    return /["\r\n]/.test(value) || value.includes(delimiter)
        ? `"${value.replace(/"/g, '""')}"`
        : value;
}

function escapeHtmlCell(value: string): string {
    const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function formatExport(matrix: string[][], format: ExportFormat): string {
    switch (format) {
        case ExportFormat.Csv:
            return matrix
                .map((row) => row.map((value) => escapeDelimitedValue(value, ',')).join(','))
                .join('\n');
        case ExportFormat.Tsv:
            return matrix
                .map((row) => row.map((value) => escapeDelimitedValue(value, '\t')).join('\t'))
                .join('\n');
        case ExportFormat.Html:
            return matrix
                .map(
                    (row) =>
                        `<tr>${row.map((value) => `<td>${escapeHtmlCell(value)}</td>`).join('')}</tr>`,
                )
                .join('\n');
        default:
            throw new Error(`Unknown export format: ${format}`);
    }
}
