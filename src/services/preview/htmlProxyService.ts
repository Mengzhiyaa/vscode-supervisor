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
    normalizeProxyPath,
    rewriteProxyLocation,
    rewriteRootRelativeUrls,
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

/**
 * A lightweight proxy that serves local HTML files and their resources over HTTP.
 * This mirrors Positron's HTML proxy behavior for htmlwidgets/plotly content.
 */
export class HtmlProxyService implements vscode.Disposable {
    private readonly _fileServers = new Map<string, FileProxyServerInfo>();
    private readonly _httpServers = new Map<string, HttpProxyServerInfo>();

    constructor(private readonly _outputChannel: vscode.LogOutputChannel) { }

    /**
     * Resolves a file path or URL to a proxied HTTP URI.
     * If the path is already http/https, it is returned as-is.
     */
    async resolvePath(targetPath: string): Promise<vscode.Uri> {
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
        const root = stat.isDirectory() ? filePath : path.dirname(filePath);
        const server = await this._ensureFileServer(root);
        const relativePath = stat.isDirectory()
            ? '/'
            : this._toUrlPath(path.relative(root, filePath));

        return this._buildExternalUri(server.externalBaseUri, relativePath);
    }

    private async _resolveHttpPath(targetPath: string): Promise<vscode.Uri> {
        const targetUrl = new URL(targetPath);
        const server = await this._ensureHttpServer(targetUrl.origin);
        const proxiedPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        return this._buildExternalUri(server.externalBaseUri, proxiedPath);
    }

    private async _ensureFileServer(root: string): Promise<FileProxyServerInfo> {
        const normalizedRoot = path.resolve(root);
        const existing = this._fileServers.get(normalizedRoot);
        if (existing) {
            return existing;
        }

        let info: FileProxyServerInfo | undefined;
        const server = http.createServer((req, res) => {
            void this._handleFileRequest(info!, req, res);
        });
        const port = await new Promise<number>((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => {
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
        info = {
            root: normalizedRoot,
            server,
            port,
            baseUrl,
            externalBaseUri,
            proxyPath: normalizeProxyPath(externalBaseUri.path),
        };

        this._fileServers.set(normalizedRoot, info);
        this._outputChannel.debug(
            `[HtmlProxyService] Started HTML file proxy for ${normalizedRoot} on ${info.baseUrl}`
        );
        return info;
    }

    private async _ensureHttpServer(targetOrigin: string): Promise<HttpProxyServerInfo> {
        const existing = this._httpServers.get(targetOrigin);
        if (existing) {
            return existing;
        }

        let info: HttpProxyServerInfo | undefined;
        const server = http.createServer((req, res) => {
            void this._handleHttpRequest(info!, req, res);
        });
        server.on('upgrade', (req, socket, head) => {
            void this._handleHttpUpgrade(info!, req, socket, head);
        });

        const port = await new Promise<number>((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => {
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
        info = {
            targetOrigin,
            server,
            port,
            baseUrl,
            externalBaseUri,
            proxyPath: normalizeProxyPath(externalBaseUri.path),
        };

        this._httpServers.set(targetOrigin, info);
        this._outputChannel.debug(
            `[HtmlProxyService] Started HTTP proxy for ${targetOrigin} on ${info.baseUrl}`
        );
        return info;
    }

    private async _handleFileRequest(
        info: FileProxyServerInfo,
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        try {
            if (!this._isAllowedMethod(req.method)) {
                res.writeHead(405);
                res.end('Method not allowed');
                return;
            }

            const url = new URL(req.url || '/', info.baseUrl);
            let requestPath = decodeURIComponent(url.pathname);
            if (requestPath.startsWith('/')) {
                requestPath = requestPath.slice(1);
            }

            const resolvedRoot = path.resolve(info.root);
            const resolvedPath = path.resolve(info.root, requestPath);
            if (
                resolvedPath !== resolvedRoot &&
                !resolvedPath.startsWith(resolvedRoot + path.sep)
            ) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            let stat = await fs.stat(resolvedPath);
            let filePath = resolvedPath;
            if (stat.isDirectory()) {
                filePath = path.join(resolvedPath, 'index.html');
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
                const rewritten = rewriteRootRelativeUrls(content, info.proxyPath);
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

            createReadStream(filePath).pipe(res);
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
        try {
            const requestUrl = new URL(req.url || '/', info.targetOrigin);
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
            const rewritten = rewriteRootRelativeUrls(
                Buffer.concat(chunks).toString('utf8'),
                info.proxyPath
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
        for (const server of this._fileServers.values()) {
            server.server.close();
        }
        for (const server of this._httpServers.values()) {
            server.server.close();
        }
        this._fileServers.clear();
        this._httpServers.clear();
    }
}
