/*---------------------------------------------------------------------------------------------
 *  HTML Proxy Service
 *  Provides a local HTTP server for HTML files with relative resources.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { Duplex } from 'stream';
import { createReadStream, promises as fs } from 'fs';
import * as vscode from 'vscode';
import WebSocket, { WebSocketServer } from 'ws';
import {
    buildWebSocketTargetUrl,
    buildProxyPath,
    isHtmlContentType,
    injectViewerBridge,
    normalizeProxyPath,
    rewriteProxyLocation,
    rewriteRootRelativeUrls,
    VIEWER_BRIDGE_PATH,
    VIEWER_BRIDGE_SCRIPT,
} from './htmlProxyUtils';

interface BaseProxyServerInfo {
    server: http.Server;
    port: number;
    baseUrl: string;
    externalBaseUri: vscode.Uri;
    proxyPath: string;
}

interface FileProxyServerInfo extends BaseProxyServerInfo {
    root: string;
}

interface HttpProxyServerInfo extends BaseProxyServerInfo {
    targetOrigin: string;
}

interface ProxyResource {
    info: BaseProxyServerInfo;
    references: number;
    external: boolean;
    timer?: ReturnType<typeof setTimeout>;
    remove: () => void;
}

const UnclaimedProxyTimeoutMs = 120_000;
const ReleasedProxyTimeoutMs = 5_000;
const ExternalProxyTimeoutMs = 30 * 60_000;

/**
 * A lightweight proxy that serves local HTML files and their resources over HTTP.
 * This mirrors Positron's HTML proxy behavior for htmlwidgets/plotly content.
 */
export class HtmlProxyService implements vscode.Disposable {
    private readonly _fileServers = new Map<string, FileProxyServerInfo>();
    private readonly _httpServers = new Map<string, HttpProxyServerInfo>();
    private readonly _pendingFileServers = new Map<string, Promise<FileProxyServerInfo>>();
    private readonly _pendingHttpServers = new Map<string, Promise<HttpProxyServerInfo>>();
    private readonly _servers = new Set<http.Server>();
    private readonly _sockets = new Set<Duplex>();
    private readonly _serverSockets = new Map<http.Server, Set<Duplex>>();
    private readonly _resources = new Map<http.Server, ProxyResource>();
    private _disposed = false;

    constructor(private readonly _outputChannel: vscode.LogOutputChannel) { }

    /**
     * Resolves a file path or URL to a proxied HTTP URI.
     * If the path is already http/https, it is returned as-is.
     */
    async resolvePath(targetPath: string, fileRoot?: string): Promise<vscode.Uri> {
        if (this._disposed) {
            throw new Error('HTML proxy service has been disposed');
        }
        if (!targetPath) {
            throw new Error('Empty HTML path');
        }

        const normalized = targetPath.trim();
        if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
            return this._resolveHttpPath(normalized);
        }

        const filePath = normalized.startsWith('file://')
            ? vscode.Uri.parse(normalized).fsPath
            : normalized;

        const stat = await fs.stat(filePath);
        const root = fileRoot ?? (stat.isDirectory() ? filePath : path.dirname(filePath));
        const server = await this._ensureFileServer(root);
        let relativePath = this._toUrlPath(path.relative(root, filePath));
        if (stat.isDirectory() && !relativePath.endsWith('/')) {
            relativePath += '/';
        }

        return this._buildExternalUri(server.externalBaseUri, relativePath);
    }

    private async _resolveHttpPath(targetPath: string): Promise<vscode.Uri> {
        const targetUrl = new URL(targetPath);
        const server = await this._ensureHttpServer(targetUrl.origin);
        const proxiedPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        return this._buildExternalUri(server.externalBaseUri, proxiedPath);
    }

    private async _ensureFileServer(root: string): Promise<FileProxyServerInfo> {
        const normalizedRoot = await fs.realpath(root);
        if (this._disposed) {
            throw new Error('HTML proxy service has been disposed');
        }
        const existing = this._fileServers.get(normalizedRoot);
        if (existing) {
            const resource = this._resources.get(existing.server);
            if (resource) {
                this._scheduleRelease(resource, UnclaimedProxyTimeoutMs);
            }
            return existing;
        }

        const pending = this._pendingFileServers.get(normalizedRoot);
        if (pending) {
            return pending;
        }
        const creation = this._createFileServer(normalizedRoot);
        this._pendingFileServers.set(normalizedRoot, creation);
        try {
            return await creation;
        } finally {
            this._pendingFileServers.delete(normalizedRoot);
        }
    }

    private async _createFileServer(normalizedRoot: string): Promise<FileProxyServerInfo> {
        let info: FileProxyServerInfo | undefined;
        const server = http.createServer((req, res) => {
            if (!info) {
                res.writeHead(503);
                res.end('Proxy is starting');
                return;
            }
            void this._handleFileRequest(info, req, res);
        });
        const { port, baseUrl, externalBaseUri } = await this._startServer(server);
        if (this._disposed) {
            throw new Error('HTML proxy service has been disposed');
        }
        info = {
            root: normalizedRoot,
            server,
            port,
            baseUrl,
            externalBaseUri,
            proxyPath: normalizeProxyPath(externalBaseUri.path),
        };

        this._fileServers.set(normalizedRoot, info);
        this._registerResource(info, () => this._fileServers.delete(normalizedRoot));
        this._outputChannel.debug(
            `[HtmlProxyService] Started HTML file proxy for ${normalizedRoot} on ${info.baseUrl}`
        );
        return info;
    }

    private async _ensureHttpServer(targetOrigin: string): Promise<HttpProxyServerInfo> {
        const existing = this._httpServers.get(targetOrigin);
        if (existing) {
            const resource = this._resources.get(existing.server);
            if (resource) {
                this._scheduleRelease(resource, UnclaimedProxyTimeoutMs);
            }
            return existing;
        }

        const pending = this._pendingHttpServers.get(targetOrigin);
        if (pending) {
            return pending;
        }
        const creation = this._createHttpServer(targetOrigin);
        this._pendingHttpServers.set(targetOrigin, creation);
        try {
            return await creation;
        } finally {
            this._pendingHttpServers.delete(targetOrigin);
        }
    }

    private async _createHttpServer(targetOrigin: string): Promise<HttpProxyServerInfo> {
        let info: HttpProxyServerInfo | undefined;
        const server = http.createServer((req, res) => {
            if (!info) {
                res.writeHead(503);
                res.end('Proxy is starting');
                return;
            }
            void this._handleHttpRequest(info, req, res);
        });
        server.on('upgrade', (req, socket, head) => {
            if (!info) {
                socket.destroy();
                return;
            }
            void this._handleHttpUpgrade(info, req, socket, head).catch(error => {
                this._outputChannel.debug(`[HtmlProxyService] Websocket upgrade failed: ${error}`);
                socket.destroy();
            });
        });
        const { port, baseUrl, externalBaseUri } = await this._startServer(server);
        if (this._disposed) {
            throw new Error('HTML proxy service has been disposed');
        }
        info = {
            targetOrigin,
            server,
            port,
            baseUrl,
            externalBaseUri,
            proxyPath: normalizeProxyPath(externalBaseUri.path),
        };

        this._httpServers.set(targetOrigin, info);
        this._registerResource(info, () => this._httpServers.delete(targetOrigin));
        this._outputChannel.debug(
            `[HtmlProxyService] Started HTTP proxy for ${targetOrigin} on ${info.baseUrl}`
        );
        return info;
    }

    private async _startServer(server: http.Server): Promise<{
        port: number;
        baseUrl: string;
        externalBaseUri: vscode.Uri;
    }> {
        if (this._disposed) {
            throw new Error('HTML proxy service has been disposed');
        }
        this._servers.add(server);
        const sockets = new Set<Duplex>();
        this._serverSockets.set(server, sockets);
        server.on('connection', socket => {
            sockets.add(socket);
            this._sockets.add(socket);
            socket.once('close', () => {
                sockets.delete(socket);
                this._sockets.delete(socket);
            });
        });
        server.once('close', () => {
            this._servers.delete(server);
            this._serverSockets.delete(server);
        });
        server.on('error', error => {
            this._outputChannel.debug(`[HtmlProxyService] Server error: ${error}`);
        });
        try {
            const port = await new Promise<number>((resolve, reject) => {
                const cleanup = () => {
                    server.off('error', onError);
                    server.off('close', onClose);
                };
                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };
                const onClose = () => onError(new Error('Proxy closed during startup'));
                server.once('error', onError);
                server.once('close', onClose);
                server.listen(0, '127.0.0.1', () => {
                    cleanup();
                    const address = server.address();
                    if (typeof address === 'object' && address && address.port) {
                        resolve(address.port);
                    } else {
                        reject(new Error('Failed to bind proxy server'));
                    }
                });
            });
            const baseUrl = `http://127.0.0.1:${port}`;
            const externalBaseUri = await vscode.env.asExternalUri(vscode.Uri.parse(baseUrl));
            if (this._disposed) {
                throw new Error('HTML proxy service has been disposed');
            }
            return { port, baseUrl, externalBaseUri };
        } catch (error) {
            for (const socket of sockets) {
                socket.destroy();
            }
            server.close();
            this._servers.delete(server);
            throw error;
        }
    }

    private _isWithinRoot(root: string, filePath: string): boolean {
        const relative = path.relative(root, filePath);
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }

    private _registerResource(info: BaseProxyServerInfo, remove: () => void): void {
        const resource: ProxyResource = { info, remove, references: 0, external: false };
        this._resources.set(info.server, resource);
        this._scheduleRelease(resource, UnclaimedProxyTimeoutMs);
    }

    /** Keep a proxy alive while a Viewer history entry, plot or editor owns its URI. */
    retainUri(uri: vscode.Uri): vscode.Disposable {
        const resource = this._findResource(uri);
        if (!resource || this._disposed) {
            return new vscode.Disposable(() => {});
        }
        resource.references++;
        clearTimeout(resource.timer);
        let released = false;
        return new vscode.Disposable(() => {
            if (released) {
                return;
            }
            released = true;
            resource.references--;
            this._scheduleRelease(resource, ReleasedProxyTimeoutMs);
        });
    }

    /** External windows have no close event; traffic renews their bounded idle lifetime. */
    keepAliveForExternalWindow(uri: vscode.Uri): void {
        const resource = this._findResource(uri);
        if (resource) {
            resource.external = true;
            this._scheduleRelease(resource, ExternalProxyTimeoutMs);
        }
    }

    /** Preserve the source of in-page navigation so a released proxy can be recreated. */
    sourceUri(uri: vscode.Uri): vscode.Uri | undefined {
        const resource = this._findResource(uri);
        if (!resource) {
            return undefined;
        }
        const info = resource.info;
        const prefix = info.externalBaseUri.path.replace(/\/$/, '');
        const resourcePath = uri.path.slice(prefix.length) || '/';
        if ('root' in info && typeof info.root === 'string') {
            return vscode.Uri.file(path.join(info.root, decodeURIComponent(resourcePath)))
                .with({ query: uri.query, fragment: uri.fragment });
        }
        if ('targetOrigin' in info && typeof info.targetOrigin === 'string') {
            return vscode.Uri.parse(info.targetOrigin).with({
                path: resourcePath, query: uri.query, fragment: uri.fragment,
            });
        }
        return undefined;
    }

    fileRoot(uri: vscode.Uri): string | undefined {
        const info = this._findResource(uri)?.info;
        return info && 'root' in info && typeof info.root === 'string' ? info.root : undefined;
    }

    private _findResource(uri: vscode.Uri): ProxyResource | undefined {
        return [...this._resources.values()].find(({ info }) => {
            const base = info.externalBaseUri;
            const prefix = base.path.replace(/\/$/, '');
            return uri.scheme === base.scheme && uri.authority === base.authority &&
                (uri.path === prefix || uri.path.startsWith(`${prefix}/`));
        });
    }

    private _scheduleRelease(resource: ProxyResource, timeout: number): void {
        clearTimeout(resource.timer);
        if (this._disposed || resource.references > 0) {
            return;
        }
        resource.timer = setTimeout(() => {
            if (resource.references > 0) {
                return;
            }
            resource.remove();
            this._resources.delete(resource.info.server);
            for (const socket of this._serverSockets.get(resource.info.server) ?? []) {
                socket.destroy();
            }
            resource.info.server.close();
        }, resource.external ? ExternalProxyTimeoutMs : timeout);
        resource.timer.unref();
    }

    private _retainRequest(info: BaseProxyServerInfo, res: http.ServerResponse): void {
        const lease = this.retainUri(info.externalBaseUri);
        res.once('finish', () => lease.dispose());
        res.once('close', () => lease.dispose());
    }

    private async _handleFileRequest(
        info: FileProxyServerInfo,
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        this._retainRequest(info, res);
        try {
            if (!this._isAllowedMethod(req.method)) {
                res.writeHead(405);
                res.end('Method not allowed');
                return;
            }

            const url = new URL(req.url || '/', info.baseUrl);
            if (url.pathname.endsWith(VIEWER_BRIDGE_PATH)) {
                this._writeViewerBridge(req, res);
                return;
            }
            let requestPath = decodeURIComponent(url.pathname);
            if (requestPath.startsWith('/')) {
                requestPath = requestPath.slice(1);
            }

            const resolvedRoot = path.resolve(info.root);
            const resolvedPath = path.resolve(info.root, requestPath);
            if (!this._isWithinRoot(resolvedRoot, resolvedPath)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            let filePath = await fs.realpath(resolvedPath);
            if (!this._isWithinRoot(resolvedRoot, filePath)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            let stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                filePath = await fs.realpath(path.join(filePath, 'index.html'));
                if (!this._isWithinRoot(resolvedRoot, filePath)) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }
                stat = await fs.stat(filePath);
            }

            if (!stat.isFile()) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const contentType = this._getContentType(filePath);
            if (isHtmlContentType(contentType)) {
                const content = await fs.readFile(filePath, 'utf8');
                const rewritten = injectViewerBridge(
                    rewriteRootRelativeUrls(content, info.proxyPath),
                    info.proxyPath,
                );
                const body = Buffer.from(rewritten, 'utf8');
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': body.byteLength,
                    'Cache-Control': 'no-cache',
                });
                if (req.method === 'HEAD') {
                    res.end();
                    return;
                }
                res.end(body);
                return;
            }

            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stat.size,
                'Cache-Control': 'no-cache',
            });
            if (req.method === 'HEAD') {
                res.end();
                return;
            }

            const stream = createReadStream(filePath);
            stream.on('error', error => res.destroy(error));
            res.once('close', () => stream.destroy());
            stream.pipe(res);
        } catch (error) {
            res.writeHead(404);
            res.end('Not found');
            this._outputChannel.debug(`[HtmlProxyService] Failed to serve file request: ${error}`);
        }
    }

    private async _handleHttpRequest(
        info: HttpProxyServerInfo,
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        this._retainRequest(info, res);
        try {
            const requestUrl = new URL(req.url || '/', info.targetOrigin);
            if (requestUrl.pathname.endsWith(VIEWER_BRIDGE_PATH)) {
                this._writeViewerBridge(req, res);
                return;
            }
            const transport = requestUrl.protocol === 'https:' ? https : http;
            const headers: http.OutgoingHttpHeaders = {
                ...req.headers,
                host: requestUrl.host,
                'accept-encoding': 'identity',
            };

            if (typeof headers.origin === 'string') {
                headers.origin = requestUrl.origin;
            }

            const upstream = transport.request(
                requestUrl,
                {
                    method: req.method,
                    headers,
                },
                (upstreamResponse) => {
                    void this._handleHttpResponse(info, req, res, upstreamResponse);
                }
            );

            upstream.on('error', (error) => {
                this._outputChannel.debug(
                    `[HtmlProxyService] Failed to proxy ${requestUrl.toString()}: ${error}`
                );
                if (!res.headersSent) {
                    res.writeHead(502);
                    res.end('Bad gateway');
                }
            });

            req.on('aborted', () => {
                upstream.destroy();
            });
            res.once('close', () => upstream.destroy());

            if (req.method === 'GET' || req.method === 'HEAD' || req.method === undefined) {
                upstream.end();
            } else {
                req.pipe(upstream);
            }
        } catch (error) {
            this._outputChannel.debug(`[HtmlProxyService] Failed to prepare HTTP proxy request: ${error}`);
            if (!res.headersSent) {
                res.writeHead(502);
                res.end('Bad gateway');
            }
        }
    }

    private async _handleHttpResponse(
        info: HttpProxyServerInfo,
        req: http.IncomingMessage,
        res: http.ServerResponse,
        upstreamResponse: http.IncomingMessage
    ): Promise<void> {
        const headers = this._cloneResponseHeaders(upstreamResponse.headers);
        headers['cache-control'] = 'no-cache';
        this._rewriteLocationHeader(headers, info);

        const statusCode = upstreamResponse.statusCode ?? 200;
        const statusMessage = upstreamResponse.statusMessage;
        const contentType = this._getHeaderValue(upstreamResponse.headers['content-type']);
        const contentEncoding = this._getHeaderValue(upstreamResponse.headers['content-encoding']);

        if (
            req.method === 'HEAD' ||
            !isHtmlContentType(contentType) ||
            (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity')
        ) {
            res.writeHead(statusCode, statusMessage, headers);
            if (req.method === 'HEAD') {
                upstreamResponse.resume();
                res.end();
                return;
            }
            upstreamResponse.pipe(res);
            return;
        }

        const chunks: Buffer[] = [];
        upstreamResponse.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        upstreamResponse.on('end', () => {
            const rewritten = injectViewerBridge(
                rewriteRootRelativeUrls(
                    Buffer.concat(chunks).toString('utf8'),
                    info.proxyPath,
                ),
                info.proxyPath,
            );
            const body = Buffer.from(rewritten, 'utf8');

            delete headers['content-length'];
            delete headers['content-encoding'];
            delete headers['transfer-encoding'];
            headers['content-type'] = 'text/html; charset=utf-8';
            headers['content-length'] = body.byteLength;

            res.writeHead(statusCode, statusMessage, headers);
            res.end(body);
        });

        upstreamResponse.on('error', (error) => {
            this._outputChannel.debug(`[HtmlProxyService] Failed to read proxied response: ${error}`);
            if (!res.headersSent) {
                res.writeHead(502);
                res.end('Bad gateway');
            } else {
                res.end();
            }
        });
    }

    private async _handleHttpUpgrade(
        info: HttpProxyServerInfo,
        req: http.IncomingMessage,
        socket: Duplex,
        head: Buffer
    ): Promise<void> {
        const lease = this.retainUri(info.externalBaseUri);
        socket.once('close', () => lease.dispose());
        const targetUrl = buildWebSocketTargetUrl(info.targetOrigin, req.url || '/');
        const requestedProtocols = this._parseWebSocketProtocols(req.headers['sec-websocket-protocol']);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
                headers[key] = value;
            } else if (Array.isArray(value)) {
                headers[key] = value.join(', ');
            }
        }

        const target = new URL(targetUrl);
        headers.host = target.host;
        if (typeof headers.origin === 'string') {
            headers.origin = `${target.protocol === 'wss:' ? 'https:' : 'http:'}//${target.host}`;
        }

        const upstream = new WebSocket(
            targetUrl,
            requestedProtocols.length > 0 ? requestedProtocols : undefined,
            { headers }
        );

        let downstreamUpgraded = false;

        upstream.once('open', () => {
            if (socket.destroyed) {
                upstream.close();
                return;
            }

            const selectedProtocol = upstream.protocol;
            const wss = selectedProtocol
                ? new WebSocketServer({
                    noServer: true,
                    handleProtocols: (protocols) => (
                        protocols.has(selectedProtocol) ? selectedProtocol : false
                    ),
                })
                : new WebSocketServer({ noServer: true });

            wss.handleUpgrade(req, socket, head, (downstream) => {
                downstreamUpgraded = true;
                this._bridgeWebSockets(upstream, downstream);
            });
        });

        upstream.once('error', (error) => {
            this._outputChannel.debug(
                `[HtmlProxyService] Failed to proxy websocket ${targetUrl}: ${error}`
            );
            if (!downstreamUpgraded && !socket.destroyed) {
                socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                socket.destroy();
            }
        });

        socket.once('error', () => {
            upstream.terminate();
        });

        socket.once('close', () => {
            if (!downstreamUpgraded) {
                upstream.terminate();
            }
        });
    }

    private _bridgeWebSockets(upstream: WebSocket, downstream: WebSocket): void {
        const closePeer = (source: WebSocket, target: WebSocket, code: number, reason: Buffer) => {
            if (target.readyState === WebSocket.OPEN || target.readyState === WebSocket.CONNECTING) {
                const normalizedCode = this._normalizeWebSocketCloseCode(code);
                if (normalizedCode === undefined) {
                    target.close();
                } else {
                    target.close(normalizedCode, reason.toString());
                }
            }
            if (source.readyState === WebSocket.CLOSING) {
                source.terminate();
            }
        };

        upstream.on('message', (data, isBinary) => {
            if (downstream.readyState === WebSocket.OPEN) {
                downstream.send(data, { binary: isBinary });
            }
        });
        downstream.on('message', (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
                upstream.send(data, { binary: isBinary });
            }
        });

        upstream.once('close', (code, reason) => {
            closePeer(upstream, downstream, code, reason);
        });
        downstream.once('close', (code, reason) => {
            closePeer(downstream, upstream, code, reason);
        });

        upstream.once('error', (error) => {
            this._outputChannel.debug(`[HtmlProxyService] Upstream websocket error: ${error}`);
            downstream.terminate();
        });
        downstream.once('error', (error) => {
            this._outputChannel.debug(`[HtmlProxyService] Downstream websocket error: ${error}`);
            upstream.terminate();
        });
    }

    private _parseWebSocketProtocols(header: string | string[] | undefined): string[] {
        const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
        return raw
            .split(',')
            .map(value => value.trim())
            .filter(value => value.length > 0);
    }

    private _normalizeWebSocketCloseCode(code: number): number | undefined {
        if (code === 1000 || (code >= 3000 && code <= 4999)) {
            return code;
        }

        return undefined;
    }

    private _isAllowedMethod(method: string | undefined): boolean {
        return method === 'GET' || method === 'HEAD' || method === undefined;
    }

    private _buildExternalUri(baseUri: vscode.Uri, resourcePath: string): vscode.Uri {
        const parsed = new URL(resourcePath, 'http://127.0.0.1');
        return baseUri.with({
            path: buildProxyPath(baseUri.path, parsed.pathname),
            query: parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search,
            fragment: parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash,
        });
    }

    private _writeViewerBridge(
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): void {
        const body = Buffer.from(VIEWER_BRIDGE_SCRIPT, 'utf8');
        res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Content-Length': body.byteLength,
            'Cache-Control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
    }

    private _cloneResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
        return { ...headers };
    }

    private _rewriteLocationHeader(
        headers: http.OutgoingHttpHeaders,
        info: HttpProxyServerInfo
    ): void {
        const location = headers.location;
        if (Array.isArray(location)) {
            headers.location = rewriteProxyLocation(location[0], info.targetOrigin, info.proxyPath);
            return;
        }

        if (typeof location === 'string') {
            headers.location = rewriteProxyLocation(location, info.targetOrigin, info.proxyPath);
        }
    }

    private _getHeaderValue(
        value: string | string[] | number | undefined
    ): string | undefined {
        if (Array.isArray(value)) {
            return value[0];
        }
        if (typeof value === 'number') {
            return String(value);
        }
        return value;
    }

    private _toUrlPath(filePath: string): string {
        if (!filePath || filePath === '.') {
            return '/';
        }

        return `/${filePath
            .split(path.sep)
            .map(segment => encodeURIComponent(segment))
            .join('/')}`;
    }

    private _getContentType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.html':
            case '.htm':
                return 'text/html';
            case '.js':
                return 'text/javascript';
            case '.css':
                return 'text/css';
            case '.json':
                return 'application/json';
            case '.svg':
                return 'image/svg+xml';
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            case '.woff':
                return 'font/woff';
            case '.woff2':
                return 'font/woff2';
            case '.ttf':
                return 'font/ttf';
            case '.map':
                return 'application/json';
            default:
                return 'application/octet-stream';
        }
    }

    dispose(): void {
        this._disposed = true;
        for (const resource of this._resources.values()) {
            clearTimeout(resource.timer);
        }
        this._resources.clear();
        for (const socket of this._sockets) {
            socket.destroy();
        }
        this._sockets.clear();
        for (const server of this._servers) {
            server.close();
        }
        this._servers.clear();
        this._fileServers.clear();
        this._httpServers.clear();
    }
}
