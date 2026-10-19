import * as assert from 'assert';
import * as vscode from 'vscode';
import { RuntimeOutputKind } from '../../internal/runtimeTypes';
import type { RuntimeRenderedOutput } from '../../api';
import { PositronPreviewService } from '../../services/preview';
import {
    RichOutputRouter,
    RuntimeOutputConsumers,
    type RichOutputMessage,
} from '../../runtime/richOutputRouter';
import { RuntimeOutputMime } from '../../runtime/runtimeOutputContract';
import { RuntimeMessageEmitter } from '../../supervisor/RuntimeMessageEmitter';
import { JupyterChannel } from '../../supervisor/jupyter/JupyterChannel';
import { JupyterMessageType } from '../../supervisor/jupyter/JupyterMessageType';
import {
    environment,
    EnvironmentContributionFilter,
    getPositronCompatibilityCapabilities,
    methods,
    registerEnvironmentContributions,
    setConsoleWidthSource,
    window as positronWindow,
} from '../../supervisor/positron';

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'rich-output-contract-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: createEventStub(),
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

function output(kind: RuntimeOutputKind, data: Record<string, unknown>): RichOutputMessage {
    return {
        id: `message-${kind}`,
        event_clock: 1,
        parent_id: 'execution-1',
        when: new Date(0).toISOString(),
        type: 'output' as any,
        kind,
        data,
        output_id: `output-${kind}`,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

suite('[Unit] P0 rich output and compatibility contracts', () => {
    for (const stage of ['render', 'html-write']) {
        for (const action of ['clear', 'delete-session', 'dispose']) {
            test(`discards late ${stage} results after ${action} and releases renderer output`, async () => {
                const entered = deferred<void>();
                const result = deferred<RuntimeRenderedOutput>();
                const htmlFile = deferred<vscode.Uri>();
                const models = new Map<string, unknown>();
                let shown = 0;
                let disposed = 0;
                const uri = vscode.Uri.parse('http://localhost/widget');
                const router = new RichOutputRouter(
                    {} as any,
                    {} as any,
                    {
                        getPlotsPaneBehavior: () => ({ surface: true, raisePane: true }),
                        addHtmlOutputPlot: () => {
                            shown++;
                        },
                    } as any,
                    {
                        resolveRuntimeOutputHtmlUri: async () => uri,
                        showRuntimeOutputHtml: async () => {
                            shown++;
                        },
                    } as any,
                    makeNoopLogChannel(),
                    {
                        upsertModel: (model: { id: string }) => models.set(model.id, model),
                        disposeModel: (id: string) => models.delete(id),
                    } as any,
                );
                (router as any)._writeHtmlOutput = async () => {
                    entered.resolve();
                    return htmlFile.promise;
                };
                router.registerRenderer({
                    id: 'slow-renderer',
                    outputKinds: [RuntimeOutputKind.WebviewPreload],
                    render: async () => {
                        if (stage === 'render') {
                            entered.resolve();
                            return result.promise;
                        }
                        return { target: 'plot', html: '<div>widget</div>' };
                    },
                    disposeOutput: async () => {
                        disposed++;
                    },
                });
                const session = { sessionId: 'slow-session' } as any;
                const message = output(RuntimeOutputKind.WebviewPreload, {});
                (router as any)._enqueue(session, message);
                const route = (router as any)._routeChains.get(
                    `${session.sessionId}:${message.output_id}`,
                );
                try {
                    await entered.promise;
                    if (action === 'clear') {
                        (router as any)._handleClearOutput(session, {
                            parent_id: message.parent_id,
                            wait: false,
                        });
                    } else if (action === 'delete-session') {
                        (router as any)._detachSession(session.sessionId);
                    } else {
                        router.dispose();
                    }
                    result.resolve({ target: 'plot', uri });
                    htmlFile.resolve(vscode.Uri.file('/tmp/cancelled-widget.html'));
                    await route;
                    assert.strictEqual(shown, 0);
                    assert.strictEqual(models.size, 0);
                    assert.strictEqual(disposed, 1);
                    assert.strictEqual((router as any)._managedOutputs.size, 0);
                    assert.strictEqual((router as any)._routingOperations.size, 0);
                    assert.strictEqual(router.getRouteRecords().length, 0);
                } finally {
                    router.dispose();
                }
            });
        }
    }

    test('does not render an output cleared before its queued route starts', async () => {
        let renders = 0;
        const router = new RichOutputRouter(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            makeNoopLogChannel(),
        );
        router.registerRenderer({
            id: 'queued-renderer',
            render: async () => {
                renders++;
                return { target: 'plot', uri: vscode.Uri.parse('http://localhost/widget') };
            },
        });
        const session = { sessionId: 'queued-session' } as any;
        const message = output(RuntimeOutputKind.WebviewPreload, {});
        (router as any)._enqueue(session, message);
        const route = (router as any)._routeChains.get(`${session.sessionId}:${message.output_id}`);
        (router as any)._handleClearOutput(session, { parent_id: message.parent_id, wait: false });
        await route;
        assert.strictEqual(renders, 0);
        router.dispose();
    });

    for (const target of ['html', 'url']) {
        test(`does not publish a cleared Viewer ${target} while its proxy is being resolved`, async () => {
            const entered = deferred<void>();
            const proxy = deferred<vscode.Uri>();
            const uri = vscode.Uri.parse('http://localhost/widget');
            const fileUri = vscode.Uri.file('/tmp/viewer-cancelled-widget.html');
            const preview = new PositronPreviewService({} as any, {} as any, makeNoopLogChannel());
            let resolutions = 0;
            let shown = 0;
            let disposals = 0;
            const resolveProxy = async () => {
                // The Router resolves HTML once before the Viewer resolves it
                // for publication. Exercise cancellation at the latter await.
                if (target === 'html' && ++resolutions === 1) {
                    return uri;
                }
                entered.resolve();
                return proxy.promise;
            };
            if (target === 'html') {
                preview.resolveRuntimeOutputHtmlUri = resolveProxy;
            } else {
                (preview as any)._proxyService.resolvePath = resolveProxy;
            }
            const listener = preview.onDidShowPreview(() => {
                shown++;
            });
            const router = new RichOutputRouter(
                {} as any,
                {} as any,
                {} as any,
                preview,
                makeNoopLogChannel(),
            );
            (router as any)._writeHtmlOutput = async () => fileUri;
            router.registerRenderer({
                id: 'slow-viewer',
                render: async () =>
                    target === 'html'
                        ? { target: 'viewer', html: '<div>widget</div>' }
                        : { target: 'viewer', uri },
                disposeOutput: async () => {
                    disposals++;
                },
            });
            const session = { sessionId: 'slow-viewer-session' } as any;
            const message = output(RuntimeOutputKind.WebviewPreload, {});
            (router as any)._enqueue(session, message);
            const route = (router as any)._routeChains.get(
                `${session.sessionId}:${message.output_id}`,
            );
            try {
                await entered.promise;
                (router as any)._handleClearOutput(session, {
                    parent_id: message.parent_id,
                    wait: false,
                });
                proxy.resolve(uri);
                await route;
                assert.strictEqual(shown, 0);
                assert.strictEqual(disposals, 1);
                assert.strictEqual(router.getRouteRecords().length, 0);
                if (target === 'html') {
                    await preview.showRuntimeOutputHtml(session.sessionId, fileUri, {
                        title: 'Current',
                    });
                } else {
                    await preview.showRuntimeOutputUrl(session.sessionId, uri.toString());
                }
                assert.strictEqual(shown, 1);
            } finally {
                listener.dispose();
                router.dispose();
                preview.dispose();
            }
        });
    }

    test('waited clear cancels the old render and permits its replacement with the same display id', async () => {
        const entered = deferred<void>();
        const result = deferred<RuntimeRenderedOutput>();
        const plots: string[] = [];
        let renders = 0;
        let disposals = 0;
        const router = new RichOutputRouter(
            {} as any,
            {} as any,
            {
                getPlotsPaneBehavior: () => ({ surface: true, raisePane: true }),
                addHtmlOutputPlot: (_sessionId: string, event: { uri: vscode.Uri }) =>
                    plots.push(event.uri.toString()),
            } as any,
            {} as any,
            makeNoopLogChannel(),
        );
        router.registerRenderer({
            id: 'replacing-renderer',
            render: async () => {
                if (++renders === 1) {
                    entered.resolve();
                    return result.promise;
                }
                return { target: 'plot', uri: vscode.Uri.parse('http://localhost/new') };
            },
            disposeOutput: async () => {
                disposals++;
            },
        });
        const session = { sessionId: 'replacing-session' } as any;
        const message = output(RuntimeOutputKind.WebviewPreload, {});
        const key = `${session.sessionId}:${message.output_id}`;
        (router as any)._enqueue(session, message);
        await entered.promise;
        (router as any)._handleClearOutput(session, { parent_id: message.parent_id, wait: true });
        (router as any)._enqueue(session, { ...message, id: 'new-message' });
        const route = (router as any)._routeChains.get(key);
        result.resolve({ target: 'plot', uri: vscode.Uri.parse('http://localhost/old') });
        await route;
        assert.deepStrictEqual(plots, ['http://localhost/new']);
        assert.strictEqual(disposals, 1);
        assert.strictEqual((router as any)._managedOutputs.get(key).message.id, 'new-message');
        router.dispose();
    });

    test('declares at least one consumer for every output kind', () => {
        assert.deepStrictEqual(
            Object.keys(RuntimeOutputConsumers).sort(),
            Object.values(RuntimeOutputKind).sort(),
        );
        for (const kind of Object.values(RuntimeOutputKind)) {
            assert.ok(RuntimeOutputConsumers[kind].length > 0, `${kind} has no consumer`);
        }
        assert.strictEqual(
            new Set(Object.values(RuntimeOutputMime)).size,
            Object.values(RuntimeOutputMime).length,
            'runtime output MIME identifiers must be unique',
        );
    });

    test('forwards the real console width event and current value through compatibility API', async () => {
        const source = new vscode.EventEmitter<number>();
        const widths: number[] = [];
        const sourceRegistration = setConsoleWidthSource(source.event, () => 101);
        const listener = positronWindow.onDidChangeConsoleWidth((width) => widths.push(width));

        source.fire(132);

        assert.deepStrictEqual(widths, [132]);
        assert.strictEqual(await positronWindow.getConsoleWidth(), 101);
        assert.strictEqual(getPositronCompatibilityCapabilities().consoleWidthEvents, true);
        assert.strictEqual(getPositronCompatibilityCapabilities().consoleWidthValue, true);
        listener.dispose();
        sourceRegistration.dispose();
        source.dispose();
    });

    test('does not let a stale console width registration dispose its replacement', async () => {
        const first = new vscode.EventEmitter<number>();
        const second = new vscode.EventEmitter<number>();
        const widths: number[] = [];
        const firstRegistration = setConsoleWidthSource(first.event, () => 80);
        const secondRegistration = setConsoleWidthSource(second.event, () => 120);
        const listener = positronWindow.onDidChangeConsoleWidth((width) => widths.push(width));

        firstRegistration.dispose();
        second.fire(140);

        assert.deepStrictEqual(widths, [140]);
        assert.strictEqual(await positronWindow.getConsoleWidth(), 120);
        listener.dispose();
        secondRegistration.dispose();
        first.dispose();
        second.dispose();
    });

    test('returns explicitly registered environment contributions', async () => {
        const registration = registerEnvironmentContributions('example.language', [
            {
                action: vscode.EnvironmentVariableMutatorType.Prepend,
                name: 'PATH',
                value: '/example/bin:',
            },
        ]);

        const contributions = await environment.getEnvironmentContributions();
        assert.deepStrictEqual(contributions['example.language'], [
            {
                action: vscode.EnvironmentVariableMutatorType.Prepend,
                name: 'PATH',
                value: '/example/bin:',
            },
        ]);

        registration.dispose();
    });

    test('filters process-creation environment contributions for kernels', async () => {
        const registration = registerEnvironmentContributions('example.language', [
            {
                action: vscode.EnvironmentVariableMutatorType.Prepend,
                name: 'PATH',
                value: '/process/bin:',
                applyAtProcessCreation: true,
            },
            {
                action: vscode.EnvironmentVariableMutatorType.Prepend,
                name: 'PATH',
                value: '/shell/bin:',
                applyAtProcessCreation: false,
            },
        ]);

        const contributions = await environment.getEnvironmentContributions(
            EnvironmentContributionFilter.ProcessCreation,
        );
        assert.deepStrictEqual(
            contributions['example.language']?.map((action) => action.value),
            ['/process/bin:'],
        );
        registration.dispose();
    });

    test('preserves execute-result count and MIME-level output metadata', () => {
        const emitter = new RuntimeMessageEmitter();
        const received: any[] = [];
        const listener = emitter.event((message) => received.push(message));
        const header = {
            msg_id: 'result-1',
            session: 'session-1',
            username: 'test',
            date: '2026-07-20T00:00:00.000Z',
            msg_type: JupyterMessageType.ExecuteResult,
            version: '5.3',
        };

        emitter.emitJupyter({
            header,
            parent_header: { ...header, msg_id: 'execute-1' },
            metadata: { message: true },
            content: {
                data: { [RuntimeOutputMime.textPlain]: '42' },
                metadata: { [RuntimeOutputMime.textPlain]: { isolated: true } },
                execution_count: 7,
                transient: { display_id: 'display-1' },
            },
            channel: JupyterChannel.IOPub,
            buffers: [],
        });

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].execution_count, 7);
        assert.deepStrictEqual(received[0].outputMetadata, {
            [RuntimeOutputMime.textPlain]: { isolated: true },
        });
        assert.deepStrictEqual(received[0].metadata, { message: true });
        listener.dispose();
        emitter.dispose();
    });

    test('does not promote Jupyter comm_close to a runtime message', () => {
        const emitter = new RuntimeMessageEmitter();
        const received: any[] = [];
        const listener = emitter.event((message) => received.push(message));
        const header = {
            msg_id: 'comm-close-1',
            session: 'session-1',
            username: 'test',
            date: '2026-07-29T00:00:00.000Z',
            msg_type: JupyterMessageType.CommClose,
            version: '5.3',
        };

        emitter.emitJupyter({
            header,
            parent_header: { ...header, msg_id: 'comm-open-1' },
            metadata: { reason: 'backend-closed' },
            content: {
                comm_id: 'data-explorer-1',
                data: { reason: 'binding-changed' },
            },
            channel: JupyterChannel.IOPub,
            buffers: [],
        });

        // Positron's supervisor handles unmanaged comm closures locally and
        // does not translate managed Jupyter comm_close packets into runtime
        // CommClosed messages.
        assert.deepStrictEqual(received, []);
        listener.dispose();
        emitter.dispose();
    });

    test('reports unsupported context keys instead of silently evaluating them', async () => {
        const reply = await methods.call('evaluate_when_clause', {
            when_clause: 'positron.somePrivateContext',
        });
        assert.ok('error' in reply);
        if ('error' in reply) {
            assert.match(reply.error.message, /only config\.\* identifiers are supported/);
        }
    });

    test('routes viewer URLs, HTML plots, and unsupported widgets without dropping them', async () => {
        const shownUrls: string[] = [];
        const shownFallbacks: string[] = [];
        const plots: string[] = [];
        const storageUri = vscode.Uri.file('/tmp/vscode-supervisor-rich-output-contract-test');
        const session = { sessionId: 'session-1' } as any;
        const router = new RichOutputRouter(
            { globalStorageUri: storageUri } as any,
            {
                sessions: [],
                onDidCreateSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
            } as any,
            {
                getPlotsPaneBehavior: () => ({ surface: true, raisePane: true }),
                addHtmlOutputPlot: (_sessionId: string, event: { uri: vscode.Uri }) => {
                    plots.push(event.uri.toString());
                },
            } as any,
            {
                showRuntimeOutputUrl: async (_sessionId: string, url: string) => {
                    shownUrls.push(url);
                },
                showRuntimeOutputHtml: async (
                    _sessionId: string,
                    _uri: vscode.Uri,
                    options: { fallbackReason?: string },
                ) => {
                    if (options.fallbackReason) {
                        shownFallbacks.push(options.fallbackReason);
                    }
                },
                resolveRuntimeOutputHtmlUri: async (uri: vscode.Uri) => uri,
            } as any,
            makeNoopLogChannel(),
        );

        await (router as any)._routeOutput(
            session,
            output(RuntimeOutputKind.ViewerWidget, {
                [RuntimeOutputMime.positronViewer]: JSON.stringify({
                    url: 'https://example.com/app',
                }),
            }),
        );
        await (router as any)._routeOutput(
            session,
            output(RuntimeOutputKind.PlotWidget, {
                [RuntimeOutputMime.textHtml]: '<div id="plot">plot</div>',
            }),
        );
        await (router as any)._routeOutput(
            session,
            output(RuntimeOutputKind.IPyWidget, {
                [RuntimeOutputMime.widgetView]: JSON.stringify({ model_id: 'widget-1' }),
                [RuntimeOutputMime.textPlain]: 'Widget(model_id=widget-1)',
            }),
        );
        await (router as any)._routeOutput(
            {
                sessionId: 'notebook-session-1',
                sessionMetadata: { sessionMode: 'notebook' },
            },
            output(RuntimeOutputKind.ViewerWidget, {
                [RuntimeOutputMime.positronDataExplorer]: JSON.stringify({
                    comm_id: 'data-explorer-1',
                }),
            }),
        );

        assert.deepStrictEqual(shownUrls, ['https://example.com/app']);
        assert.strictEqual(plots.length, 1);
        assert.strictEqual(shownFallbacks.length, 1);
        assert.match(shownFallbacks[0], /IPyWidget rendering is not available/);
        assert.strictEqual(
            router.getRouteRecords('notebook-session-1')[0]?.consumer,
            'notebook-inline-data-explorer',
        );

        router.dispose();
        await vscode.workspace.fs.delete(storageUri, { recursive: true, useTrash: false });
    });

    test('routes preload-dependent output through a registered renderer before fallback', async () => {
        const plots: string[] = [];
        const storageUri = vscode.Uri.file('/tmp/vscode-supervisor-renderer-bridge-test');
        const router = new RichOutputRouter(
            { globalStorageUri: storageUri } as any,
            {
                sessions: [],
                onDidCreateSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
            } as any,
            {
                getPlotsPaneBehavior: () => ({ surface: true, raisePane: true }),
                addHtmlOutputPlot: (_sessionId: string, event: { uri: vscode.Uri }) => {
                    plots.push(event.uri.toString());
                },
            } as any,
            {
                resolveRuntimeOutputHtmlUri: async (uri: vscode.Uri) => uri,
            } as any,
            makeNoopLogChannel(),
        );
        const registration = router.registerRenderer({
            id: 'bokeh-renderer',
            mimeTypes: [RuntimeOutputMime.bokehExec],
            outputKinds: [RuntimeOutputKind.WebviewPreload],
            render: async () => ({
                target: 'plot',
                title: 'Bokeh',
                html: '<div id=\"bokeh\">rendered</div>',
            }),
        });

        await (router as any)._routeOutput(
            { sessionId: 'renderer-session' },
            output(RuntimeOutputKind.WebviewPreload, {
                [RuntimeOutputMime.bokehExec]: { model: 'plot-1' },
            }),
        );

        assert.strictEqual(plots.length, 1);
        assert.strictEqual(router.getRouteRecords('renderer-session')[0]?.consumer, 'renderer');
        registration.dispose();
        router.dispose();
        await vscode.workspace.fs.delete(storageUri, { recursive: true, useTrash: false });
    });

    test('replays managed widget output when a renderer registers late and disposes it on clear', async () => {
        const storageUri = vscode.Uri.file('/tmp/vscode-supervisor-renderer-replay-test');
        let fallbackCount = 0;
        let renderCount = 0;
        let disposeCount = 0;
        let renderedOutputId: string | undefined;
        const router = new RichOutputRouter(
            { globalStorageUri: storageUri } as any,
            {
                sessions: [],
                onDidCreateSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
            } as any,
            {
                getPlotsPaneBehavior: () => ({ surface: true, raisePane: true }),
                addHtmlOutputPlot: () => undefined,
            } as any,
            {
                showRuntimeOutputHtml: async (
                    _sessionId: string,
                    _uri: vscode.Uri,
                    options: { fallbackReason?: string },
                ) => {
                    if (options.fallbackReason) {
                        fallbackCount++;
                    }
                },
                resolveRuntimeOutputHtmlUri: async (uri: vscode.Uri) => uri,
            } as any,
            makeNoopLogChannel(),
        );
        const session = { sessionId: 'renderer-replay-session' } as any;
        const message = output(RuntimeOutputKind.IPyWidget, {
            [RuntimeOutputMime.widgetView]: { model_id: 'widget-replay-1' },
        });
        const key = `${session.sessionId}:${message.output_id}`;

        (router as any)._enqueue(session, message);
        await (router as any)._routeChains.get(key);
        assert.strictEqual(fallbackCount, 1);

        const registration = router.registerRenderer({
            id: 'late-widget-renderer',
            outputKinds: [RuntimeOutputKind.IPyWidget],
            render: async (_message, context) => {
                renderCount++;
                renderedOutputId = context.outputId;
                return { target: 'plot', html: '<div>interactive widget</div>' };
            },
            disposeOutput: async (context) => {
                assert.strictEqual(context.outputId, message.output_id);
                disposeCount++;
            },
        });
        await (router as any)._routeChains.get(key);

        assert.strictEqual(renderCount, 1);
        assert.strictEqual(renderedOutputId, message.output_id);
        (router as any)._handleClearOutput(session, {
            parent_id: message.parent_id,
            wait: false,
        });
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(disposeCount, 1);
        assert.strictEqual((router as any)._managedOutputs.size, 0);

        registration.dispose();
        router.dispose();
        await vscode.workspace.fs.delete(storageUri, { recursive: true, useTrash: false });
    });

    test('confirms data explorer acceptance, instance creation, and editor attachment separately', async () => {
        const commId = 'data-explorer-console-1';
        const model = {
            id: `data-explorer:${encodeURIComponent(commId)}`,
            attachments: [{ kind: 'data-explorer-editor' }],
        };
        const router = new RichOutputRouter(
            { globalStorageUri: vscode.Uri.file('/tmp/rich-output-phases') } as any,
            {
                sessions: [],
                onDidCreateSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
            } as any,
            {} as any,
            {} as any,
            makeNoopLogChannel(),
            {
                getModel: (modelId: string) => (modelId === model.id ? model : undefined),
                onDidChange: createEventStub(),
            } as any,
        );
        const session = {
            sessionId: 'console-session-1',
            sessionMetadata: { sessionMode: 'console' },
        } as any;

        await (router as any)._routeOutput(
            session,
            output(RuntimeOutputKind.ViewerWidget, {
                [RuntimeOutputMime.positronDataExplorer]: JSON.stringify({ comm_id: commId }),
            }),
        );

        const records = router.getRouteRecords(session.sessionId);
        assert.deepStrictEqual(
            records.map((record) => record.status),
            ['accepted', 'instance-created', 'surface-opened'],
        );
        assert.deepStrictEqual(
            records.map((record) => record.phase),
            ['accepted', 'instance-created', 'surface-opened'],
        );
        assert.deepStrictEqual(
            records.map((record) => record.rendererCompatible),
            [false, false, true],
        );
        router.dispose();
    });
});
