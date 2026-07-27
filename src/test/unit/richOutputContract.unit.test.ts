import * as assert from 'assert';
import * as vscode from 'vscode';
import { RuntimeOutputKind } from '../../internal/runtimeTypes';
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

suite('[Unit] P0 rich output and compatibility contracts', () => {
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
        const listener = positronWindow.onDidChangeConsoleWidth(width => widths.push(width));

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
        const listener = positronWindow.onDidChangeConsoleWidth(width => widths.push(width));

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
        const registration = registerEnvironmentContributions('example.language', [{
            action: vscode.EnvironmentVariableMutatorType.Prepend,
            name: 'PATH',
            value: '/example/bin:',
        }]);

        const contributions = await environment.getEnvironmentContributions();
        assert.deepStrictEqual(contributions['example.language'], [{
            action: vscode.EnvironmentVariableMutatorType.Prepend,
            name: 'PATH',
            value: '/example/bin:',
        }]);

        registration.dispose();
    });

    test('preserves execute-result count and MIME-level output metadata', () => {
        const emitter = new RuntimeMessageEmitter();
        const received: any[] = [];
        const listener = emitter.event(message => received.push(message));
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

        await (router as any)._routeOutput(session, output(RuntimeOutputKind.ViewerWidget, {
            [RuntimeOutputMime.positronViewer]: JSON.stringify({ url: 'https://example.com/app' }),
        }));
        await (router as any)._routeOutput(session, output(RuntimeOutputKind.PlotWidget, {
            [RuntimeOutputMime.textHtml]: '<div id="plot">plot</div>',
        }));
        await (router as any)._routeOutput(session, output(RuntimeOutputKind.IPyWidget, {
            [RuntimeOutputMime.widgetView]: JSON.stringify({ model_id: 'widget-1' }),
            [RuntimeOutputMime.textPlain]: 'Widget(model_id=widget-1)',
        }));
        await (router as any)._routeOutput({
            sessionId: 'notebook-session-1',
            sessionMetadata: { sessionMode: 'notebook' },
        }, output(RuntimeOutputKind.ViewerWidget, {
            [RuntimeOutputMime.positronDataExplorer]: JSON.stringify({ comm_id: 'data-explorer-1' }),
        }));

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
                getModel: (modelId: string) => modelId === model.id ? model : undefined,
                onDidChange: createEventStub(),
            } as any,
        );
        const session = {
            sessionId: 'console-session-1',
            sessionMetadata: { sessionMode: 'console' },
        } as any;

        await (router as any)._routeOutput(session, output(RuntimeOutputKind.ViewerWidget, {
            [RuntimeOutputMime.positronDataExplorer]: JSON.stringify({ comm_id: commId }),
        }));

        const records = router.getRouteRecords(session.sessionId);
        assert.deepStrictEqual(records.map(record => record.status), [
            'accepted',
            'instance-created',
            'surface-opened',
        ]);
        assert.deepStrictEqual(records.map(record => record.phase), [
            'accepted',
            'instance-created',
            'surface-opened',
        ]);
        assert.deepStrictEqual(records.map(record => record.rendererCompatible), [false, false, true]);
        router.dispose();
    });
});
