import * as zlib from 'zlib';

const EndOfCentralDirectorySignature = 0x06054b50;
const CentralDirectoryEntrySignature = 0x02014b50;
const LocalFileHeaderSignature = 0x04034b50;
const WorkbookEntryName = 'xl/workbook.xml';

/** Reads worksheet names from the small workbook metadata entry in an XLSX archive. */
export function readXlsxWorksheetNames(data: Uint8Array): readonly string[] | undefined {
    const workbookXml = readZipEntry(data, WorkbookEntryName);
    if (!workbookXml) {
        return undefined;
    }
    const xml = new TextDecoder('utf-8').decode(workbookXml);
    const names: string[] = [];
    const sheetPattern = /<sheet\b[^>]*\bname="([^"]*)"[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = sheetPattern.exec(xml)) !== null) {
        names.push(decodeXmlEntities(match[1]));
    }
    return names.length > 0 ? names : undefined;
}

function readZipEntry(data: Uint8Array, entryName: string): Uint8Array | undefined {
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
        const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
        if (name === entryName) {
            return inflateLocalEntry(buffer, localHeaderOffset, compressedSize, compressionMethod);
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

function inflateLocalEntry(
    buffer: Buffer,
    localHeaderOffset: number,
    compressedSize: number,
    compressionMethod: number,
): Uint8Array | undefined {
    if (
        localHeaderOffset < 0 ||
        localHeaderOffset + 30 > buffer.length ||
        buffer.readUInt32LE(localHeaderOffset) !== LocalFileHeaderSignature
    ) {
        return undefined;
    }
    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
    if (dataOffset + compressedSize > buffer.length) {
        return undefined;
    }
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (compressionMethod === 0) {
        return compressed;
    }
    if (compressionMethod === 8) {
        try {
            return zlib.inflateRawSync(compressed);
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
                return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
            }
        }
    });
}
