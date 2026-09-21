import * as zlib from 'zlib';
import * as path from 'path';
import * as vscode from 'vscode';
import { throwIfImportCancelled } from './fileImport';

const EndOfCentralDirectorySignature = 0x06054b50;
const CentralDirectoryEntrySignature = 0x02014b50;
const LocalFileHeaderSignature = 0x04034b50;
const WorkbookEntryName = 'xl/workbook.xml';
const MaxWorkbookMetadataBytes = 4 * 1024 * 1024;

export interface XlsxRange {
    ref: string;
    width: number;
    height: number;
}

export interface XlsxWorksheetMetadata {
    /** Undefined means enumeration failed, not that the workbook has no sheets. */
    sheets?: readonly string[];
    range?: XlsxRange;
}

function attribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
    const value = match?.[1] ?? match?.[2];
    return value === undefined ? undefined : decodeXmlEntities(value);
}

function workbookSheets(xml: string): Array<{ name: string; relationship?: string }> {
    const sheets: Array<{ name: string; relationship?: string }> = [];
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?sheet\b[^>]*>/g)) {
        const name = attribute(match[0], 'name');
        if (name !== undefined) {
            sheets.push({ name, relationship: attribute(match[0], 'r:id') });
        }
    }
    return sheets;
}

function parseRange(value: string | undefined): XlsxRange | undefined {
    const match = value?.trim().match(/^\$?([A-Za-z]+)\$?([1-9]\d*)(?::\$?([A-Za-z]+)\$?([1-9]\d*))?$/);
    if (!match) {
        return undefined;
    }
    const column = (letters: string) => [...letters.toUpperCase()]
        .reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0);
    const left = column(match[1]);
    const right = column(match[3] ?? match[1]);
    const top = Number(match[2]);
    const bottom = Number(match[4] ?? match[2]);
    if (right < left || bottom < top || right > 16384 || bottom > 1048576) {
        return undefined;
    }
    return {
        ref: value!.trim().replace(/\$/g, '').toUpperCase(),
        width: right - left + 1,
        height: bottom - top + 1,
    };
}

/** Read only metadata and the worksheet prefix, before transferring the XLSX buffer to DuckDB. */
export async function readXlsxWorksheetMetadata(
    data: Uint8Array,
    sheetName: string | undefined,
    token: vscode.CancellationToken,
): Promise<XlsxWorksheetMetadata> {
    const workbook = await readEntryText(data, WorkbookEntryName, MaxWorkbookMetadataBytes, false, token);
    if (workbook === undefined) {
        return {};
    }
    const sheets = workbookSheets(workbook);
    const metadata: XlsxWorksheetMetadata = { sheets: sheets.length > 0 ? sheets.map(sheet => sheet.name) : undefined };
    const selected = sheetName === undefined ? sheets[0] : sheets.find(sheet => sheet.name === sheetName);
    if (!selected?.relationship) {
        return metadata;
    }
    const relationships = await readEntryText(data, 'xl/_rels/workbook.xml.rels', MaxWorkbookMetadataBytes, false, token);
    if (relationships === undefined) {
        return metadata;
    }
    for (const match of relationships.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) {
        if (attribute(match[0], 'Id') !== selected.relationship || attribute(match[0], 'TargetMode') === 'External') {
            continue;
        }
        const target = attribute(match[0], 'Target');
        if (!target) {
            break;
        }
        const entry = path.posix.normalize(target.startsWith('/')
            ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`);
        if (!entry.startsWith('xl/')) {
            break;
        }
        const head = await readEntryText(data, entry, 64 * 1024, true, token);
        const dimension = head?.match(/<(?:[\w.-]+:)?dimension\b[^>]*>/)?.[0];
        metadata.range = parseRange(dimension ? attribute(dimension, 'ref') : undefined);
        break;
    }
    return metadata;
}

async function readEntryText(
    data: Uint8Array,
    name: string,
    limit: number,
    allowPrefix: boolean,
    token: vscode.CancellationToken,
): Promise<string | undefined> {
    throwIfImportCancelled(token);
    const entry = findZipEntry(data, name);
    if (!entry) {
        return undefined;
    }
    if (entry.method === 0) {
        return !allowPrefix && entry.bytes.byteLength > limit
            ? undefined : entry.bytes.subarray(0, limit).toString('utf8');
    }
    if (entry.method !== 8) {
        return undefined;
    }
    return new Promise((resolve, reject) => {
        const stream = zlib.createInflateRaw();
        const chunks: Buffer[] = [];
        let length = 0;
        let settled = false;
        let subscription: vscode.Disposable | undefined;
        const finish = (text?: string, error?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            subscription?.dispose();
            stream.destroy();
            if (error) { reject(error); } else { resolve(text); }
        };
        subscription = token.onCancellationRequested(() => finish(undefined, new vscode.CancellationError()));
        stream.on('error', () => finish());
        stream.on('data', (chunk: Buffer) => {
            if (settled) {
                return;
            }
            const remaining = limit - length;
            chunks.push(chunk.subarray(0, remaining));
            length += chunk.byteLength;
            if (length >= limit && allowPrefix) {
                finish(Buffer.concat(chunks).toString('utf8'));
            } else if (length > limit) {
                finish();
            }
        });
        stream.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
        if (token.isCancellationRequested) {
            finish(undefined, new vscode.CancellationError());
        } else {
            stream.end(entry.bytes);
        }
    });
}

/** Reads worksheet names from the small workbook metadata entry in an XLSX archive. */
export function readXlsxWorksheetNames(data: Uint8Array): readonly string[] | undefined {
    const workbookXml = readZipEntry(data, WorkbookEntryName);
    if (!workbookXml) {
        return undefined;
    }
    const xml = new TextDecoder('utf-8').decode(workbookXml);
    const names = workbookSheets(xml).map(sheet => sheet.name);
    return names.length > 0 ? names : undefined;
}

function findZipEntry(data: Uint8Array, entryName: string): { bytes: Buffer; method: number } | undefined {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
        return undefined;
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let offset = buffer.readUInt32LE(eocdOffset + 16);
    for (let index = 0; index < entryCount && offset + 46 <= buffer.length; index++) {
        if (buffer.readUInt32LE(offset) !== CentralDirectoryEntrySignature) {
            return undefined;
        }
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const nameStart = offset + 46;
        if (nameStart + fileNameLength + extraLength + commentLength > buffer.length) {
            return undefined;
        }
        const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
        if (name === entryName) {
            if (localHeaderOffset + 30 > buffer.length ||
                buffer.readUInt32LE(localHeaderOffset) !== LocalFileHeaderSignature ||
                (buffer.readUInt16LE(offset + 8) & 1) !== 0) {
                return undefined;
            }
            const dataOffset = localHeaderOffset + 30 + buffer.readUInt16LE(localHeaderOffset + 26) +
                buffer.readUInt16LE(localHeaderOffset + 28);
            return dataOffset + compressedSize <= buffer.length
                ? { bytes: buffer.subarray(dataOffset, dataOffset + compressedSize), method: compressionMethod }
                : undefined;
        }
        offset = nameStart + fileNameLength + extraLength + commentLength;
    }
    return undefined;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
    const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
    for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
        if (buffer.readUInt32LE(offset) === EndOfCentralDirectorySignature) {
            return offset;
        }
    }
    return -1;
}

function readZipEntry(data: Uint8Array, entryName: string): Uint8Array | undefined {
    const entry = findZipEntry(data, entryName);
    if (!entry || entry.bytes.byteLength > MaxWorkbookMetadataBytes) {
        return undefined;
    }
    if (entry.method === 0) {
        return entry.bytes;
    }
    if (entry.method === 8) {
        try {
            return zlib.inflateRawSync(entry.bytes, { maxOutputLength: MaxWorkbookMetadataBytes });
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function decodeXmlEntities(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
        switch (entity.toLowerCase()) {
            case '&amp;': return '&';
            case '&lt;': return '<';
            case '&gt;': return '>';
            case '&quot;': return '"';
            case '&apos;': return '\'';
            default: {
                const hexadecimal = entity[2]?.toLowerCase() === 'x';
                const value = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
                return Number.isInteger(value) && value >= 0 && value <= 0x10ffff &&
                    !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
            }
        }
    });
}
