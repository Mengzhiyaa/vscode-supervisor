import * as assert from 'assert';
import { readXlsxWorksheetNames } from '../../services/duckdb/xlsxWorkbook';

suite('[Unit] XLSX workbook metadata', () => {
    test('reads worksheet names in workbook order and decodes XML entities', () => {
        const xml = '<workbook><sheets><sheet name="Summary"/><sheet name="Sales &amp; Tax"/></sheets></workbook>';
        const archive = createStoredZip('xl/workbook.xml', Buffer.from(xml));
        assert.deepStrictEqual(readXlsxWorksheetNames(archive), ['Summary', 'Sales & Tax']);
    });

    test('returns undefined for malformed archives', () => {
        assert.strictEqual(readXlsxWorksheetNames(Buffer.from('not-a-zip')), undefined);
    });
});

function createStoredZip(name: string, contents: Buffer): Buffer {
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBuffer.length + contents.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    contents.copy(local, 30 + nameBuffer.length);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(0, 42);
    nameBuffer.copy(central, 46);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, central, end]);
}
