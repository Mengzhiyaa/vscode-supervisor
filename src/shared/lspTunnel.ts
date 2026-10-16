/** Inner LSP JSON-RPC messages are independent of the outer Webview RPC IDs. */
export interface LspJsonRpcMessage {
    jsonrpc: '2.0';
    id?: string | number | null;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export interface ConsoleLspConfiguration {
    rootUri?: string;
    workspaceFolders?: readonly { uri: string; name: string }[];
    initializationOptions?: unknown;
    settings?: Readonly<Record<string, unknown>>;
    allowedCommands?: readonly string[];
    kernelCompletionFallback?: boolean;
}

export interface LspTunnelOpenParams {
    sessionId: string;
    webviewClientId: string;
    modelUri: string;
}

export interface LspTunnelOpenResult {
    supported: boolean;
    /** False while the language session manager has not activated the Host LSP. */
    available?: boolean;
    tunnelId?: string;
    epoch?: number;
    configuration?: ConsoleLspConfiguration;
}

export interface LspTunnelKey {
    tunnelId: string;
    epoch: number;
}

export interface LspTunnelMessage extends LspTunnelKey {
    message: LspJsonRpcMessage;
}

export interface LspTunnelState extends LspTunnelKey {
    state: 'closed' | 'failed';
    reason?: string;
}

export interface LspTunnelOpenDocument extends LspTunnelKey {
    uri: string;
    selection?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface LspTunnelConfigurationChanged {
    sessionId: string;
    generation: number;
}

export interface LspTunnelAvailabilityChanged {
    sessionId: string;
    generation: number;
    available: boolean;
}

export function consoleLspModelUri(sessionId: string, languageId: string): string {
    const suffix = languageId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return `inmemory://console/session-${encodeURIComponent(sessionId)}.${suffix || 'plaintext'}`;
}

export const LSP_TUNNEL_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
export const LSP_TUNNEL_MAX_QUEUED_BYTES = 16 * 1024 * 1024;

export function isLspJsonRpcMessage(value: unknown): value is LspJsonRpcMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const message = value as Record<string, unknown>;
    if (message.jsonrpc !== '2.0' ||
        ('id' in message && message.id !== null &&
            typeof message.id !== 'string' &&
            !(typeof message.id === 'number' && Number.isSafeInteger(message.id)))) {
        return false;
    }
    if ('method' in message) {
        return typeof message.method === 'string' && !('result' in message) && !('error' in message);
    }
    if (!('id' in message) || ('result' in message) === ('error' in message)) {
        return false;
    }
    const error = message.error as Record<string, unknown> | undefined;
    return !('error' in message) || Boolean(error && typeof error === 'object' &&
        Number.isInteger(error.code) && typeof error.message === 'string');
}
