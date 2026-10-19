import * as assert from 'assert';
import * as vscode from 'vscode';
import { decodeImageDataUri, imageFileName } from '../../shared/imageDataUri';
import { savePlotImage } from '../../runtime/plotImageExport';
import { StaticPlotClient } from '../../runtime/staticPlotClient';
import { PlotClientInstance } from '../../runtime/PlotClientInstance';
import { PositronPlotsService } from '../../runtime/positronPlotsService';
import { PlotEditorProvider } from '../../editor/PlotEditorProvider';
import { PlotsViewProvider } from '../../webview/plotsProvider';
import { PlotRenderFormat } from '../../runtime/comms/positronPlotComm';
import type { PositronPlotCommProxy } from '../../runtime/comms/positronPlotCommProxy';
import type { DeferredRender } from '../../runtime/positronPlotRenderQueue';
import { LanguageRuntimeMessageType, RuntimeClientType } from '../../internal/runtimeTypes';

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
        quickPick: vscode.window.showQuickPick,
        input: vscode.window.showInputBox,
    };
    const target = vscode.Uri.parse('plot-export-test:/figure.svg');
    const writeFailureMessage = 'Plot export test: write denied';
    let fileSystem: vscode.Disposable;
    let denyWrites = false;
    let dialogs: vscode.SaveDialogOptions[];
    let writes: { uri: string; bytes: Buffer }[];
    let errors: string[];
    let formatPrompts: number;

    suiteSetup(() => {
        fileSystem = vscode.workspace.registerFileSystemProvider('plot-export-test', {
            onDidChangeFile: () => new vscode.Disposable(() => undefined),
            watch: () => new vscode.Disposable(() => undefined),
            stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }),
            readDirectory: () => [],
            createDirectory: () => undefined,
            readFile: () => writes.at(-1)?.bytes ?? new Uint8Array(),
            writeFile: async (uri, bytes) => {
                if (denyWrites) { throw vscode.FileSystemError.NoPermissions(writeFailureMessage); }
                writes.push({ uri: uri.toString(), bytes: Buffer.from(bytes) });
            },
            delete: () => undefined,
            rename: () => undefined,
        });
    });
    suiteTeardown(() => fileSystem.dispose());
    setup(() => {
        dialogs = []; writes = []; errors = []; denyWrites = false; formatPrompts = 0;
        vscode.window.showSaveDialog = async options => { dialogs.push(options!); return target; };
        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showErrorMessage = async (message: string) => { errors.push(message); return undefined; };
        vscode.window.showWarningMessage = async () => undefined;
        vscode.window.showQuickPick = (async (items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>) => {
            formatPrompts += 1;
            const selected = (await items).find(item =>
                (item as vscode.QuickPickItem & { format?: PlotRenderFormat }).format === PlotRenderFormat.Svg);
            assert.ok(selected, 'expected the export format picker');
            return selected;
        }) as unknown as typeof vscode.window.showQuickPick;
        vscode.window.showInputBox = async options => {
            if (options?.prompt === vscode.l10n.t('Width x height in logical pixels')) { return '640 x 480'; }
            assert.strictEqual(options?.prompt, vscode.l10n.t('Pixel ratio (1 is standard resolution)'));
            return '2';
        };
    });
    teardown(() => {
        vscode.window.showSaveDialog = originals.dialog;
        vscode.window.showInformationMessage = originals.info;
        vscode.window.showErrorMessage = originals.error;
        vscode.window.showWarningMessage = originals.warning;
        vscode.window.showQuickPick = originals.quickPick;
        vscode.window.showInputBox = originals.input;
    });

    // Exercise the real handlers without creating visible Webviews or live comms.
    async function saveVia(route: string, dynamic = false) {
        const plot = StaticPlotClient.fromMessage('session', 'plot', '2026-09-22T00:00:00Z', 'image/svg+xml', svg);
        const renderRequests: DeferredRender[] = [];
        const subscribe = () => new vscode.Disposable(() => undefined);
        const proxy = {
            onDidClose: subscribe, onDidRenderUpdate: subscribe,
            onDidShowPlot: subscribe, onDidSetIntrinsicSize: subscribe,
            getIntrinsicSize: async () => undefined,
            render: (request: DeferredRender) => {
                renderRequests.push(request);
                request.complete({ ...request.renderRequest, uri: svgUri, renderTimeMs: 1 });
            },
        } as unknown as PositronPlotCommProxy;
        const client = dynamic ? new PlotClientInstance({
            id: 'plot', comm_id: 'plot', target_name: RuntimeClientType.Plot,
            type: LanguageRuntimeMessageType.CommOpen,
            data: { pre_render: {
                data: 'Y2FjaGVk', mime_type: 'image/png',
                settings: { size: { width: 320, height: 240 }, pixel_ratio: 1, format: PlotRenderFormat.Png },
            } },
            event_clock: 0, parent_id: '', when: new Date().toISOString(),
        }, () => undefined, () => undefined, 'session', undefined, proxy) : plot;
        client.metadata.suggested_file_name = 'figure.png';
        const displayedRender = client instanceof PlotClientInstance ? client.lastRender : undefined;
        const displayPolicy = client instanceof PlotClientInstance ? client.sizingPolicy : undefined;
        const service: PositronPlotsService = Object.assign(Object.create(PositronPlotsService.prototype), {
            _plots: [client], _selectedPlotId: 'plot', _editorPlotClients: new Map([['plot', client]]),
        });
        let panelResult: { success: boolean; error?: string } | undefined;
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
                try {
                    internal._currentPlotContent.set('plot', { kind: 'image', data: svgUri });
                    await internal._saveCurrentPlot('plot');
                } finally {
                    editor.dispose();
                    log.dispose();
                }
            }
            if (route === 'panel') {
                const requests = new Map<string, (params: { plotId: string }) => Promise<unknown>>();
                const panel = Object.assign(Object.create(PlotsViewProvider.prototype), {
                    _plotsService: service,
                    _plots: new Map([['plot', { kind: dynamic ? 'dynamic' : 'static', data: svgUri, suggestedFileName: 'figure.png' }]]),
                    log: () => undefined,
                });
                panel._registerPlotExportHandlers({ onRequest: (method: string, handler: (params: { plotId: string }) => Promise<unknown>) => requests.set(method, handler) });
                panelResult = await requests.get('plots/save')!({ plotId: 'plot' }) as typeof panelResult;
            }
            if (client instanceof PlotClientInstance) {
                assert.strictEqual(client.lastRender, displayedRender, 'export must preserve the displayed image');
                assert.strictEqual(client.sizingPolicy, displayPolicy, 'export must preserve the display sizing policy');
            }
            return { renderRequests, panelResult };
        } finally {
            if (client !== plot) { client.dispose(); }
            plot.dispose();
        }
    }

    for (const route of ['panel', 'editor', 'service-view', 'service-editor']) {
        for (const dynamic of [false, true]) {
            test(`${route} saves ${dynamic ? 'dynamic' : 'static'} SVG bytes and a matching filename`, async () => {
                const { renderRequests, panelResult } = await saveVia(route, dynamic);
                assert.deepStrictEqual(errors, []);
                assert.strictEqual(formatPrompts, dynamic ? 1 : 0);
                assert.strictEqual(renderRequests.length, dynamic ? 1 : 0);
                if (dynamic) {
                    assert.deepStrictEqual(renderRequests[0].renderRequest, {
                        size: { width: 640, height: 480 }, pixel_ratio: 2, format: PlotRenderFormat.Svg,
                    });
                    assert.strictEqual(renderRequests[0].options.preview, true);
                }
                if (route === 'panel') { assert.deepStrictEqual(panelResult, { success: true }); }
                assert.deepStrictEqual(writes, [{ uri: target.toString(), bytes: Buffer.from(svg) }]);
                assert.strictEqual(dialogs[0].defaultUri?.path, '/figure.svg');
                assert.deepStrictEqual(dialogs[0].filters, { 'SVG Image': ['svg'] });
            });
        }

        test(`${route} cancels dynamic export before rendering`, async () => {
            vscode.window.showQuickPick = async () => undefined;
            const { renderRequests, panelResult } = await saveVia(route, true);
            assert.deepStrictEqual(renderRequests, []);
            assert.deepStrictEqual(dialogs, []);
            assert.deepStrictEqual(writes, []);
            assert.deepStrictEqual(errors, []);
            if (route === 'panel') {
                assert.deepStrictEqual(panelResult, { success: false, error: 'Save cancelled' });
            }
        });
    }

    test('cancelled save writes nothing', async () => {
        vscode.window.showSaveDialog = async () => undefined;
        assert.strictEqual(await savePlotImage(svgUri, 'plot'), undefined);
        assert.deepStrictEqual(writes, []);
    });

    test('filesystem failures reach the caller and panel displays an error', async () => {
        denyWrites = true;
        await assert.rejects(savePlotImage(svgUri, 'plot'), {
            code: 'NoPermissions', message: writeFailureMessage,
        });
        const { panelResult } = await saveVia('panel');
        assert.deepStrictEqual(writes, []);
        assert.deepStrictEqual(errors, [vscode.l10n.t('Failed to export plot: {0}', writeFailureMessage)]);
        assert.deepStrictEqual(panelResult, { success: false, error: writeFailureMessage });
    });

    test('dynamic export reports a filesystem failure instead of cancellation', async () => {
        denyWrites = true;
        const { renderRequests, panelResult } = await saveVia('panel', true);
        assert.strictEqual(renderRequests.length, 1);
        assert.deepStrictEqual(writes, []);
        assert.deepStrictEqual(errors, [vscode.l10n.t('Failed to export plot: {0}', writeFailureMessage)]);
        assert.deepStrictEqual(panelResult, { success: false, error: writeFailureMessage });
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
