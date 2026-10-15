import * as assert from 'assert';
import * as vscode from 'vscode';
import { CancellationToken, type MessageConnection } from 'vscode-jsonrpc/node';
import { LanguageLspState, type ILanguageConsoleLspBridge, type ILanguageLsp } from '../../api';
import { LspTunnelService } from '../../lspTunnel/lspTunnelService';
import type { RuntimeSession } from '../../runtime/session';
import { consoleLspModelUri, type LspJsonRpcMessage, type LspTunnelMessage, type LspTunnelOpenResult } from '../../shared/lspTunnel';

class BridgeConnection {
    readonly handlers = new Map<string, (params: unknown, token: CancellationToken) => unknown>();
    readonly messages: LspJsonRpcMessage[] = [];
    private readonly waiters = new Map<number, (message: LspJsonRpcMessage) => void>();

    onRequest(type: { method: string }, handler: (params: unknown, token: CancellationToken) => unknown): vscode.Disposable {
        this.handlers.set(type.method, handler);
        return { dispose() {} };
    }
    onClose(): vscode.Disposable { return { dispose() {} }; }
    async sendNotification(type: { method: string }, params: unknown): Promise<void> {
        if (type.method !== 'lspTunnel/message') { return; }
        const message = (params as LspTunnelMessage).message;
        this.messages.push(message);
        if (typeof message.id === 'number') {
            this.waiters.get(message.id)?.(message);
            this.waiters.delete(message.id);
        }
    }
    async call<T>(method: string, params: unknown): Promise<T> {
        return await this.handlers.get(method)!(params, CancellationToken.None) as T;
    }
    reply(id: number): Promise<LspJsonRpcMessage> {
        const message = this.messages.find(message => message.id === id);
        return message ? Promise.resolve(message) : new Promise(resolve => this.waiters.set(id, resolve));
    }
}

function fixture(waitForCompletion = false, completionResult: unknown = [{ label: 'value', data: { serverItem: 1 } }]) {
    const connection = new BridgeConnection();
    const notifications: { method: string; params: unknown }[] = [];
    const requests: { method: string; params: unknown; token: vscode.CancellationToken }[] = [];
    const received = new vscode.EventEmitter<{ method: string; params?: unknown }>();
    const event: vscode.Event<void> = () => ({ dispose() {} });
    const bridge: ILanguageConsoleLspBridge = {
        capabilities: { textDocumentSync: { openClose: true, change: 1 }, completionProvider: { resolveProvider: true } },
        registrations: [],
        onDidReceiveNotification: received.event,
        async sendRequest(method, params, token) {
            requests.push({ method, params, token });
            if (method === 'textDocument/completion') {
                if (waitForCompletion) { return new Promise(() => {}); }
                return completionResult;
            }
            return { ...params as Record<string, unknown>, detail: 'resolved' };
        },
        async sendNotification(method, params) { notifications.push({ method, params }); },
        registerRequestHandler() { return { dispose() {} }; },
    };
    const lsp: ILanguageLsp = {
        state: LanguageLspState.Running, consoleLspBridge: bridge,
        async activate() {}, async deactivate() {}, async wait() { return true; }, showOutput() {}, dispose() {},
    };
    const session = {
        sessionId: 'bridge-session', runtimeMetadata: { languageId: 'r' }, sessionMetadata: { sessionMode: 'console' },
        consoleLspConfiguration: {}, boundLspGeneration: 1, lsp,
        getRuntimeState: () => 'ready', activateLsp: async () => {},
        onDidChangeConsoleLspConfiguration: event, onDidEndSession: event, onDidChangeRuntimeState: event,
    } as unknown as RuntimeSession;
    const service = new LspTunnelService(connection as unknown as MessageConnection, () => session,
        { debug() {} } as unknown as vscode.LogOutputChannel);
    const uri = consoleLspModelUri(session.sessionId, 'r');
    return { connection, notifications, requests, service, uri, session, received };
}

async function open(fixtureValue: ReturnType<typeof fixture>) {
    const { connection, uri, session } = fixtureValue;
    const result = await connection.call<LspTunnelOpenResult>('lspTunnel/open', {
        sessionId: session.sessionId, webviewClientId: 'test-client', modelUri: uri,
    });
    assert.strictEqual(result.supported, true);
    const key = { tunnelId: result.tunnelId!, epoch: result.epoch! };
    const send = (message: LspJsonRpcMessage) => connection.call<void>('lspTunnel/send', { ...key, message });
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
    assert.ok((await connection.reply(1)).result);
    await send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    await send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
        textDocument: { uri, languageId: 'r', version: 1, text: 'value' },
    } });
    return { key, send };
}

suite('Console Host LSP bridge', () => {
    test('retains list default edit ranges and resolve data with item overrides', async function () {
        if (!vscode.workspace.isTrusted) { this.skip(); }
        const editRange = {
            insert: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            replace: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        };
        const value = fixture(false, {
            isIncomplete: true,
            itemDefaults: { editRange, insertTextFormat: 2, insertTextMode: 1,
                commitCharacters: ['('], data: { resultId: 7, itemId: 0 } },
            applyKind: { data: 2, commitCharacters: 2 },
            items: [{ label: 'value', textEditText: 'value(${1:x})',
                commitCharacters: ['(', ','], data: { itemId: 1 } }],
        });
        try {
            const { send } = await open(value);
            await send({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
                textDocument: { uri: value.uri }, position: { line: 0, character: 5 },
            } });
            const result = (await value.connection.reply(2)).result as {
                isIncomplete: boolean; items: Record<string, unknown>[];
            };
            const item = result.items[0];
            assert.strictEqual(result.isIncomplete, true);
            assert.deepStrictEqual(item.textEdit, { ...editRange, newText: 'value(${1:x})' });
            assert.strictEqual(item.insertTextFormat, 2);
            assert.strictEqual(item.insertTextMode, 1);
            assert.deepStrictEqual(item.commitCharacters, ['(', ',']);
            assert.deepStrictEqual(item.data, { resultId: 7, itemId: 1 });
            await send({ jsonrpc: '2.0', id: 3, method: 'completionItem/resolve', params: item });
            assert.strictEqual((await value.connection.reply(3)).error, undefined);
            const resolved = value.requests[1].params as Record<string, unknown>;
            assert.deepStrictEqual(resolved.data, { resultId: 7, itemId: 1 });
            assert.deepStrictEqual(resolved.textEdit, item.textEdit);
            assert.strictEqual(resolved._supervisorBridgeItem, undefined);
        } finally { value.service.dispose(); value.received.dispose(); }
    });

    test('reuses Host initialization, preserves resolve data, and closes only its Console document', async function () {
        if (!vscode.workspace.isTrusted) { this.skip(); }
        const value = fixture();
        try {
            const { key, send } = await open(value);
            assert.deepStrictEqual(value.notifications.map(item => item.method), ['textDocument/didOpen']);
            assert.strictEqual(value.requests.length, 0);
            await send({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
                textDocument: { uri: value.uri }, position: { line: 0, character: 5 },
            } });
            const item = ((await value.connection.reply(2)).result as Record<string, unknown>[])[0];
            await send({ jsonrpc: '2.0', id: 3, method: 'completionItem/resolve', params: item });
            assert.strictEqual((await value.connection.reply(3)).error, undefined);
            assert.deepStrictEqual(value.requests[1].params, { label: 'value', data: { serverItem: 1 } });
            await value.connection.call('lspTunnel/close', key);
            assert.deepStrictEqual(value.notifications.map(item => item.method), ['textDocument/didOpen', 'textDocument/didClose']);
            assert.deepStrictEqual(value.requests.map(item => item.method), ['textDocument/completion', 'completionItem/resolve']);
        } finally { value.service.dispose(); value.received.dispose(); }
    });

    test('rejects requests for other documents and settles cancellation when the Host ignores it', async function () {
        if (!vscode.workspace.isTrusted) { this.skip(); }
        const value = fixture(true);
        try {
            const { send } = await open(value);
            await send({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
                textDocument: { uri: 'file:///other.R' }, position: { line: 0, character: 0 },
            } });
            assert.ok((await value.connection.reply(2)).error);
            assert.strictEqual(value.requests.length, 0);
            await send({ jsonrpc: '2.0', id: 3, method: 'textDocument/completion', params: {
                textDocument: { uri: value.uri }, position: { line: 0, character: 5 },
            } });
            await send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 3 } });
            assert.strictEqual((await value.connection.reply(3)).error?.code, -32800);
            assert.strictEqual(value.requests[0].token.isCancellationRequested, true);
        } finally { value.service.dispose(); value.received.dispose(); }
    });
});
