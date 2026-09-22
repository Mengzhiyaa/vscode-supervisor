import * as assert from 'assert';
import * as vscode from 'vscode';
import { decodeImageDataUri, imageFileName } from '../../shared/imageDataUri';
import { savePlotImage } from '../../runtime/plotImageExport';
import { StaticPlotClient } from '../../runtime/staticPlotClient';
import { PlotClientInstance } from '../../runtime/PlotClientInstance';
import { PositronPlotsService } from '../../runtime/positronPlotsService';
import { PlotEditorProvider } from '../../editor/PlotEditorProvider';
import { PlotsViewProvider } from '../../webview/plotsProvider';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><text>中文 + 50%</text></svg>';
const svgUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

suite('[Unit] Plot image encoding', () => {
    for (const parameters of ['', ';utf8', ';charset=UTF-8']) {
        test(`decodes SVG Unicode bytes with ${parameters || 'no parameters'}`, () => {
            const image = decodeImageDataUri(`data:image/svg+xml${parameters},${encodeURIComponent(svg)}`);
            assert.strictEqual(image.mimeType, 'image/svg+xml');
            assert.deepStrictEqual(Buffer.from(image.bytes), Buffer.from(svg));
        });
    }

    test('accepts base64 MIME parameters, mixed case and unescaped Unicode', () => {
        const image = decodeImageDataUri(`DATA:IMAGE/SVG+XML;charset=UTF-8;BASE64,${Buffer.from(svg).toString('base64')}`);
        assert.deepStrictEqual(Buffer.from(image.bytes), Buffer.from(svg));
        const raw = svg.replace('50%', '文字');
        assert.deepStrictEqual(Buffer.from(decodeImageDataUri(`data:image/svg+xml,${raw}`).bytes), Buffer.from(raw));
    });

    test('preserves binary PNG/JPEG bytes for both base64 and percent encoding', () => {
        const bytes = Buffer.from([0x89, 0x50, 0x00, 0xff, 0xd8, 0x2b]);
        for (const mime of ['image/png', 'image/jpeg']) {
            for (const uri of [
                `data:${mime};base64,${bytes.toString('base64')}`,
                `data:${mime},%89%50%00%FF%D8+`,
            ]) {
                assert.deepStrictEqual(Buffer.from(decodeImageDataUri(uri).bytes), bytes);
            }
        }
    });

    test('decodes the real StaticPlotClient SVG URI', () => {
        const plot = StaticPlotClient.fromMessage('session', 'plot', '2026-09-22T00:00:00Z', 'image/svg+xml', svg);
        try {
            assert.deepStrictEqual(Buffer.from(decodeImageDataUri(plot.uri).bytes), Buffer.from(svg));
        } finally { plot.dispose(); }
    });

    test('rejects non-images and malformed encodings instead of exporting corrupt bytes', () => {
        for (const uri of ['https://example.com/plot.png', 'data:text/html,abc', 'data:image/png', 'data:image/png;base64,%%%', 'data:image/svg+xml,%GG', 'data:image/png,%']) {
            assert.throws(() => decodeImageDataUri(uri), uri);
        }
    });

    test('uses the image format and a basename for suggested export names', () => {
        assert.strictEqual(imageFileName('image/svg+xml', 'plot-1', 'figure.png'), 'figure.svg');
        assert.strictEqual(imageFileName('image/jpeg', 'plot-1', 'C:\\plots\\中文.svg'), '中文.jpg');
        assert.strictEqual(imageFileName('image/png', 'plot-1', '/tmp/figure.v2.png'), 'figure.v2.png');
        assert.strictEqual(imageFileName('image/svg+xml', 'plot-1'), 'plot-1.svg');
    });
});

suite('[Unit] Plot image export routes', () => {
    const originals = {
        dialog: vscode.window.showSaveDialog,
        info: vscode.window.showInformationMessage,
        error: vscode.window.showErrorMessage,
        warning: vscode.window.showWarningMessage,
    };
    const target = vscode.Uri.parse('plot-export-test:/figure.svg');
    let fileSystem: vscode.Disposable;
    let denyWrites = false;
    let dialogs: vscode.SaveDialogOptions[];
    let writes: { uri: string; bytes: Buffer }[];
    let errors: string[];

    suiteSetup(() => {
        fileSystem = vscode.workspace.registerFileSystemProvider('plot-export-test', {
            onDidChangeFile: () => new vscode.Disposable(() => undefined),
            watch: () => new vscode.Disposable(() => undefined),
            stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }),
            readDirectory: () => [],
            createDirectory: () => undefined,
            readFile: () => writes.at(-1)?.bytes ?? new Uint8Array(),
            writeFile: async (uri, bytes) => {
                if (denyWrites) { throw vscode.FileSystemError.NoPermissions(uri); }
                writes.push({ uri: uri.toString(), bytes: Buffer.from(bytes) });
            },
            delete: () => undefined,
            rename: () => undefined,
        });
    });
    suiteTeardown(() => fileSystem.dispose());
    setup(() => {
        dialogs = []; writes = []; errors = []; denyWrites = false;
        vscode.window.showSaveDialog = async options => { dialogs.push(options!); return target; };
        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showErrorMessage = async (message: string) => { errors.push(message); return undefined; };
        vscode.window.showWarningMessage = async () => undefined;
    });
    teardown(() => {
        vscode.window.showSaveDialog = originals.dialog;
        vscode.window.showInformationMessage = originals.info;
        vscode.window.showErrorMessage = originals.error;
        vscode.window.showWarningMessage = originals.warning;
    });

    // Exercise the real handlers without creating visible Webviews or live comms.
    async function saveVia(route: string, dynamic = false): Promise<void> {
        const plot = StaticPlotClient.fromMessage('session', 'plot', '2026-09-22T00:00:00Z', 'image/svg+xml', svg);
        plot.metadata.suggested_file_name = 'figure.png';
        const client = dynamic ? Object.assign(Object.create(PlotClientInstance.prototype), {
            _lastRender: { uri: svgUri }, metadata: plot.metadata,
        }) : plot;
        const service: PositronPlotsService = Object.assign(Object.create(PositronPlotsService.prototype), {
            _plots: [client], _selectedPlotId: 'plot', _editorPlotClients: new Map([['plot', client]]),
        });
        try {
            if (route === 'service-view') { await service.saveViewPlot(); }
            if (route === 'service-editor') { await service.saveEditorPlot('plot'); }
            if (route === 'editor') {
                const log = vscode.window.createOutputChannel('Plot export tests', { log: true });
                const editor = new PlotEditorProvider(vscode.Uri.file('/extension'), log, service);
                const internal = editor as unknown as {
                    _currentPlotContent: Map<string, { kind: 'image'; data: string }>;
                    _saveCurrentPlot(id: string): Promise<void>;
                };
                internal._currentPlotContent.set('plot', { kind: 'image', data: svgUri });
                await internal._saveCurrentPlot('plot');
                editor.dispose();
                log.dispose();
            }
            if (route === 'panel') {
                const requests = new Map<string, (params: { plotId: string }) => Promise<unknown>>();
                const panel = Object.assign(Object.create(PlotsViewProvider.prototype), {
                    _plots: new Map([['plot', { kind: dynamic ? 'dynamic' : 'static', data: svgUri, suggestedFileName: 'figure.png' }]]),
                    log: () => undefined,
                });
                panel._registerPlotExportHandlers({ onRequest: (method: string, handler: (params: { plotId: string }) => Promise<unknown>) => requests.set(method, handler) });
                await requests.get('plots/save')!({ plotId: 'plot' });
            }
        } finally { plot.dispose(); }
    }

    for (const route of ['panel', 'editor', 'service-view', 'service-editor']) {
        for (const dynamic of [false, true]) {
            test(`${route} saves ${dynamic ? 'dynamic' : 'static'} SVG bytes and a matching filename`, async () => {
                await saveVia(route, dynamic);
                assert.deepStrictEqual(errors, []);
                assert.deepStrictEqual(writes, [{ uri: target.toString(), bytes: Buffer.from(svg) }]);
                assert.strictEqual(dialogs[0].defaultUri?.path, '/figure.svg');
                assert.deepStrictEqual(dialogs[0].filters, { 'SVG Image': ['svg'] });
            });
        }
    }

    test('cancelled save writes nothing', async () => {
        vscode.window.showSaveDialog = async () => undefined;
        assert.strictEqual(await savePlotImage(svgUri, 'plot'), undefined);
        assert.deepStrictEqual(writes, []);
    });

    test('filesystem failures reach the caller and panel displays an error', async () => {
        denyWrites = true;
        await assert.rejects(savePlotImage(svgUri, 'plot'), /permission/i);
        await saveVia('panel');
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0], /export/i);
    });

    test('service clipboard fallback offers image export', async () => {
        vscode.window.showWarningMessage = (async (_message: string, action: string) => action) as unknown as typeof vscode.window.showWarningMessage;
        const plot = StaticPlotClient.fromMessage('session', 'plot', '2026-09-22T00:00:00Z', 'image/svg+xml', svg);
        const service: PositronPlotsService = Object.assign(Object.create(PositronPlotsService.prototype), {
            _plots: [plot], _selectedPlotId: 'plot', _editorPlotClients: new Map([['plot', plot]]),
        });
        try {
            await service.copyViewPlotToClipboard();
            await service.copyEditorPlotToClipboard('plot');
            assert.deepStrictEqual(writes.map(write => write.bytes), [Buffer.from(svg), Buffer.from(svg)]);
        } finally { plot.dispose(); }
    });
});
