import * as assert from 'assert';
import * as vscode from 'vscode';
import { PlotClientInstance, PlotClientState } from '../../runtime/PlotClientInstance';
import { PositronPlotsService } from '../../runtime/positronPlotsService';
import { DeferredRender, type IRenderedPlot } from '../../runtime/positronPlotRenderQueue';
import { PositronPlotCommProxy, type UpdateEvent } from '../../runtime/comms/positronPlotCommProxy';
import { PlotRenderFormat, type IntrinsicSize } from '../../runtime/comms/positronPlotComm';
import { LanguageRuntimeMessageType, RuntimeClientType } from '../../internal/runtimeTypes';
import { HtmlPlotClient } from '../../runtime/htmlPlotClient';
import { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import { PositronPlotRenderQueue, RuntimeState as QueueRuntimeState } from '../../runtime/positronPlotRenderQueue';

function fixture() {
    const close = new vscode.EventEmitter<void>();
    const update = new vscode.EventEmitter<UpdateEvent>();
    const show = new vscode.EventEmitter<void>();
    const intrinsic = new vscode.EventEmitter<IntrinsicSize | undefined>();
    const requests: DeferredRender[] = [];
    const proxy = {
        onDidClose: close.event, onDidRenderUpdate: update.event,
        onDidShowPlot: show.event, onDidSetIntrinsicSize: intrinsic.event,
        render: (request: DeferredRender) => requests.push(request),
    } as unknown as PositronPlotCommProxy;
    const clients: PlotClientInstance[] = [];
    const create = (id = 'plot') => {
        const client = new PlotClientInstance({
            id, comm_id: id, target_name: RuntimeClientType.Plot,
            type: LanguageRuntimeMessageType.CommOpen, data: {},
            event_clock: 0, parent_id: '', when: new Date().toISOString(),
        }, () => undefined, () => undefined, 'session', undefined, proxy);
        clients.push(client);
        return client;
    };
    function finish(request: DeferredRender, uri = 'data:image/png;base64,eA==') {
        request.complete({ ...request.renderRequest, uri, renderTimeMs: 1 });
    }
    return { create, requests, close, update, show, intrinsic, proxy, finish,
        dispose: () => { clients.forEach(client => client.dispose()); close.dispose(); update.dispose(); show.dispose(); intrinsic.dispose(); } };
}

suite('[Unit] Plot render parity', () => {
    let f: ReturnType<typeof fixture>;
    setup(() => { f = fixture(); });
    teardown(() => f.dispose());

    test('cache keys include output format and pixel ratio, including intrinsic sizing', async () => {
        const plot = f.create();
        const png = plot.renderPlot(undefined, 1, PlotRenderFormat.Png);
        f.finish(f.requests[0]);
        await png;
        await plot.renderPlot(undefined, 1, PlotRenderFormat.Png);
        assert.strictEqual(f.requests.length, 1);
        const svg = plot.renderPlot(undefined, 1, PlotRenderFormat.Svg);
        assert.strictEqual(f.requests.length, 2);
        f.finish(f.requests[1], 'data:image/svg+xml;base64,PHN2Zy8+');
        await svg;
        assert.strictEqual(plot.lastRender?.format, PlotRenderFormat.Svg);
        const retina = plot.renderPlot(undefined, 2, PlotRenderFormat.Svg);
        assert.strictEqual(f.requests.length, 3);
        f.finish(f.requests[2]);
        await retina;
    });

    test('cancelled older renders do not clear a newer request or its pending state', async () => {
        const plot = f.create();
        const first = plot.renderPlot({ width: 100, height: 100 }, 1);
        const rejected = assert.rejects(first, /Canceled/);
        const second = plot.renderPlot({ width: 200, height: 100 }, 1);
        await rejected;
        assert.strictEqual(plot.state, PlotClientState.RenderPending);
        f.finish(f.requests[0], 'old');
        assert.strictEqual(Boolean(plot.lastRender), false);
        f.finish(f.requests[1], 'new');
        await second;
        assert.strictEqual(plot.lastRender?.uri, 'new');
        assert.strictEqual(plot.state, PlotClientState.Rendered);
    });

    test('kernel pre-renders update immediately and rerender at the previous requested size and format', async () => {
        const plot = f.create();
        const first = plot.renderPlot({ width: 800, height: 600 }, 2, PlotRenderFormat.Svg);
        f.finish(f.requests[0]);
        await first;
        const completed: IRenderedPlot[] = [];
        plot.onDidCompleteRender(render => completed.push(render));
        f.update.fire({ pre_render: {
            data: 'eA', mime_type: 'image/png',
            settings: { size: { width: 100, height: 100 }, pixel_ratio: 1, format: PlotRenderFormat.Png },
        } });
        assert.strictEqual(completed[0].uri, 'data:image/png;base64,eA==');
        assert.deepStrictEqual(f.requests[1].renderRequest, {
            size: { width: 800, height: 600 }, pixel_ratio: 2, format: PlotRenderFormat.Svg,
        });
        f.finish(f.requests[1], 'correct-size');
        await f.requests[1].promise;
        assert.strictEqual(plot.lastRender?.uri, 'correct-size');
    });

    test('matching pre-renders satisfy the viewport without duplicate render requests', async () => {
        const plot = f.create();
        const initial = plot.renderPlot({ width: 100, height: 100 }, 1);
        f.finish(f.requests[0]);
        await initial;
        f.update.fire({ pre_render: { data: 'bmV3', mime_type: 'image/png', settings: { size: { width: 100, height: 100 }, pixel_ratio: 1, format: PlotRenderFormat.Png } } });
        assert.strictEqual(f.requests.length, 1);
        assert.strictEqual(plot.lastRender?.uri, 'data:image/png;base64,bmV3');
    });

    test('a matching kernel pre-render fulfills a pending caller instead of reporting cancellation', async () => {
        const plot = f.create();
        const pending = plot.renderPlot({ width: 100, height: 100 }, 1);
        f.update.fire({ pre_render: { data: 'bmV3', mime_type: 'image/png', settings: { size: { width: 100, height: 100 }, pixel_ratio: 1, format: PlotRenderFormat.Png } } });
        assert.strictEqual((await pending).uri, 'data:image/png;base64,bmV3');
        f.finish(f.requests[0], 'stale-response');
        assert.strictEqual(plot.lastRender?.uri, 'data:image/png;base64,bmV3');
    });

    test('disposing cancels pending work, detaches proxy listeners and emits close only once', async () => {
        const plot = f.create();
        let closed = 0;
        let shown = 0;
        plot.onDidClose(() => closed++);
        plot.onDidShowPlot(() => shown++);
        const pending = plot.renderPlot({ width: 100, height: 100 }, 1);
        const rejected = assert.rejects(pending, /Canceled/);
        plot.dispose();
        await rejected;
        plot.dispose();
        f.show.fire();
        f.update.fire({});
        f.close.fire();
        assert.strictEqual(closed, 1);
        assert.strictEqual(shown, 0);
        assert.strictEqual(plot.state, PlotClientState.Closed);
        await assert.rejects(plot.renderPlot(undefined, 1));
        assert.strictEqual(f.requests.length, 1);
    });

    test('removing the view preserves an editor client and closes the shared comm only after its final owner', async () => {
        const service = new PositronPlotsService();
        const view = f.create();
        const editor = f.create();
        service.addPlotClient(view);
        let closed = 0;
        Object.assign(service, {
            _editorPlotClients: new Map([['plot', editor]]),
            _plotClientsByComm: new Map([['plot', [view, editor]]]),
            _plotCommProxies: new Map([['plot', { dispose: () => closed++ }]]),
        });
        try {
            service.removePlot('plot');
            assert.strictEqual(service.getEditorInstance('plot'), editor);
            assert.strictEqual(closed, 0);
            const render = editor.renderPlot(undefined, 1);
            f.finish(f.requests[0]);
            await render;
            service.removeEditorPlot('plot');
            assert.strictEqual(closed, 1);
            assert.strictEqual(editor.state, PlotClientState.Closed);
        } finally { service.dispose(); }
    });

    test('closing an editor does not delete the view with the same ID', () => {
        const service = new PositronPlotsService();
        const view = f.create();
        const editor = f.create();
        service.addPlotClient(view);
        Object.assign(service, {
            _editorPlotClients: new Map([['plot', editor]]),
            _plotClientsByComm: new Map([['plot', [view, editor]]]),
        });
        try {
            service.removeEditorPlot('plot');
            assert.deepStrictEqual(service.positronPlotInstances, [view]);
            assert.strictEqual(service.getPlotClient('plot'), view);
            assert.notStrictEqual(view.state, PlotClientState.Closed);
        } finally { service.dispose(); }
    });

    test('the shared proxy closes the real kernel client once after both surface clients release it', () => {
        const state = new vscode.EventEmitter<QueueRuntimeState>();
        const queue = new PositronPlotRenderQueue({ sessionId: 'session', getRuntimeState: () => QueueRuntimeState.Idle, onDidChangeRuntimeState: state.event });
        let closed = 0;
        const raw = new RuntimeClientInstance({
            id: 'plot', comm_id: 'plot', target_name: RuntimeClientType.Plot,
            type: LanguageRuntimeMessageType.CommOpen, data: {}, event_clock: 0,
            parent_id: '', when: new Date().toISOString(),
        }, () => undefined, () => closed++);
        const proxy = new PositronPlotCommProxy(raw, queue);
        const service = new PositronPlotsService();
        const metadata = { id: 'plot', session_id: 'session', created: Date.now() };
        const access = service as unknown as { createRuntimePlotClient(proxy: PositronPlotCommProxy, value: typeof metadata, raw: RuntimeClientInstance): PlotClientInstance };
        const view = access.createRuntimePlotClient(proxy, metadata, raw);
        const editor = access.createRuntimePlotClient(proxy, metadata, view);
        service.addPlotClient(view);
        Object.assign(service, { _editorPlotClients: new Map([['plot', editor]]), _plotCommProxies: new Map([['plot', proxy]]) });
        try {
            service.removePlot('plot');
            assert.strictEqual(closed, 0);
            service.removeEditorPlot('plot');
            assert.strictEqual(closed, 1);
            proxy.dispose();
            assert.strictEqual(closed, 1);
        } finally { service.dispose(); proxy.dispose(); queue.dispose(); state.dispose(); }
    });

    test('clearing plots tolerates synchronous close events and preserves a shared HTML editor', () => {
        const service = new PositronPlotsService();
        service.addPlotClient(f.create('a'));
        service.addPlotClient(f.create('b'));
        service.addHtmlPlot('session', { uri: vscode.Uri.parse('https://localhost/plot') });
        const html = service.positronPlotInstances.find(plot => plot instanceof HtmlPlotClient)!;
        Object.assign(service, { _editorPlotClients: new Map([[html.id, html]]) });
        try {
            service.removeAllPlots();
            assert.deepStrictEqual(service.positronPlotInstances, []);
            assert.strictEqual(service.getEditorInstance(html.id), html);
            service.removeEditorPlot(html.id);
            assert.strictEqual(service.getEditorInstance(html.id), undefined);
        } finally { service.dispose(); }
    });
});
