/*---------------------------------------------------------------------------------------------
 *  Help Proxy Service
 *  Provides a local HTTP proxy for help content with injected styles/scripts.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { URL } from 'url';

export interface HelpProxyInfo {
    serverOrigin: string;
    externalUri: vscode.Uri;
    proxyPath: string;
}

class ProxyServer implements vscode.Disposable {
    constructor(
        readonly serverOrigin: string,
        readonly targetOrigin: string,
        readonly externalUri: vscode.Uri,
        readonly proxyPath: string,
        private readonly server: http.Server
    ) { }

    dispose(): void {
        this.server.close();
    }
}

class HelpHtmlConfig {
    constructor(
        readonly styleDefaults?: string,
        readonly styleOverrides?: string,
        readonly script?: string,
        public styles?: Record<string, string | number>
    ) { }

    resourcesLoaded(): boolean {
        return Boolean(this.styleDefaults || this.styleOverrides || this.script);
    }
}

const getStyleElement = (script: string, id: string) =>
    script.match(new RegExp(`<style id="${id}">.*?<\/style>`, 'gs'))?.[0];

const getScriptElement = (script: string, id: string) =>
    script.match(new RegExp(`<script id="${id}" type="module">.*?<\/script>`, 'gs'))?.[0];

export class HelpProxyService implements vscode.Disposable {
    private readonly _proxyServers = new Map<string, ProxyServer>();
    private _helpHtmlConfig: HelpHtmlConfig;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._helpHtmlConfig = this._loadHelpResources();
    }

    dispose(): void {
        for (const proxy of this._proxyServers.values()) {
            proxy.dispose();
        }
        this._proxyServers.clear();
    }

    setStyles(styles: Record<string, string | number>): void {
        this._helpHtmlConfig.styles = styles;
    }

    async startProxyServer(targetOrigin: string): Promise<HelpProxyInfo> {
        const existing = this._proxyServers.get(targetOrigin);
        if (existing) {
            return {
                serverOrigin: existing.serverOrigin,
                externalUri: existing.externalUri,
                proxyPath: existing.proxyPath
            };
        }

        const server = http.createServer((req, res) => {
            void this._handleProxyRequest(targetOrigin, req, res);
        });

        const address = await new Promise<net.AddressInfo>((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address();
                if (typeof addr === 'object' && addr) {
                    resolve(addr);
                } else {
                    reject(new Error('Failed to bind proxy server'));
                }
            });
            server.on('error', reject);
        });

        const serverOrigin = `http://${address.address}:${address.port}`;
        const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(serverOrigin));
        const proxyPath = externalUri.path && externalUri.path !== '' ? externalUri.path : '/';

        this._outputChannel.debug(`[HelpProxyService] Started help proxy ${serverOrigin} for ${targetOrigin}`);

        this._proxyServers.set(
            targetOrigin,
            new ProxyServer(serverOrigin, targetOrigin, externalUri, proxyPath, server)
        );

        return { serverOrigin, externalUri, proxyPath };
    }

    stopProxyServer(targetOrigin: string): void {
        const proxy = this._proxyServers.get(targetOrigin);
        if (proxy) {
            proxy.dispose();
            this._proxyServers.delete(targetOrigin);
            this._outputChannel.debug(`[HelpProxyService] Stopped help proxy for ${targetOrigin}`);
        }
    }

    buildProxyUrl(targetUrl: URL, proxyInfo: HelpProxyInfo): string {
        const externalUrl = new URL(proxyInfo.externalUri.toString(true));
        const proxyPath = proxyInfo.proxyPath || '/';
        const basePath = proxyPath.endsWith('/') ? proxyPath.slice(0, -1) : proxyPath;

        const joinedPath = `${basePath}${targetUrl.pathname}`.replace(/\/+/g, '/');

        externalUrl.pathname = joinedPath;
        externalUrl.search = targetUrl.search;
        externalUrl.hash = targetUrl.hash;
        return externalUrl.toString();
    }

    private _loadHelpResources(): HelpHtmlConfig {
        try {
            const scriptsPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'help', 'scripts_help.html');
            const scripts = fs.readFileSync(scriptsPath.fsPath, 'utf8');
            const styleDefaults = getStyleElement(scripts, 'help-style-defaults');
            const styleOverrides = getStyleElement(scripts, 'help-style-overrides');
            const script = getScriptElement(scripts, 'help-script');
            return new HelpHtmlConfig(styleDefaults, styleOverrides, script, {});
        } catch (error) {
            this._outputChannel.error(`[HelpProxyService] Failed to load help resources: ${error}`);
            return new HelpHtmlConfig();
        }
    }

    private async _handleProxyRequest(
        targetOrigin: string,
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        const proxy = this._proxyServers.get(targetOrigin);
        if (!proxy) {
            res.writeHead(502);
            res.end('Proxy not available');
            return;
        }

        const method = req.method || 'GET';
        let requestUrl = req.url || '/';
        const proxyPath = proxy.proxyPath && proxy.proxyPath !== '/' ? proxy.proxyPath : '';

        if (proxyPath && requestUrl.startsWith(proxyPath)) {
            requestUrl = requestUrl.slice(proxyPath.length);
            if (!requestUrl.startsWith('/')) {
                requestUrl = `/${requestUrl}`;
            }
        }

        const targetUrl = new URL(requestUrl, targetOrigin);
        const isHttps = targetUrl.protocol === 'https:';
        const transport = isHttps ? https : http;

        const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
        delete headers['accept-encoding'];

        const proxyReq = transport.request(
            {
                method,
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: `${targetUrl.pathname}${targetUrl.search}`,
                headers: {
                    ...headers,
                    host: targetUrl.host
                }
            },
            (proxyRes) => {
                const chunks: Buffer[] = [];
                proxyRes.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                proxyRes.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const contentType = String(proxyRes.headers['content-type'] || '');

                    let outputBuffer = buffer;
                    if (contentType.includes('text/html') && this._helpHtmlConfig.resourcesLoaded()) {
                        outputBuffer = this._rewriteHelpContent(buffer, contentType, proxy.proxyPath);
                    }

                    const responseHeaders = { ...proxyRes.headers } as Record<string, string | number | string[] | undefined>;
                    delete responseHeaders['content-encoding'];
                    responseHeaders['content-length'] = Buffer.byteLength(outputBuffer);

                    res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                    res.end(outputBuffer);
                });
            }
        );

        proxyReq.on('error', (error) => {
            this._outputChannel.debug(`[HelpProxyService] Proxy request failed: ${error}`);
            res.writeHead(502);
            res.end('Proxy error');
        });

        if (req.readable) {
            req.pipe(proxyReq);
        } else {
            proxyReq.end();
        }
    }

    private _rewriteHelpContent(buffer: Buffer<ArrayBuffer>, contentType: string, proxyPath: string): Buffer<ArrayBuffer> {
        if (!contentType.includes('text/html')) {
            return buffer;
        }

        let response = buffer.toString('utf8');
        const htmlConfig = this._helpHtmlConfig;

        if (htmlConfig) {
            let helpVars = '';
            const { styleDefaults, styleOverrides, script, styles } = htmlConfig;

            if (styles) {
                helpVars += '<style id="help-vars">\n';
                helpVars += '    body {\n';
                for (const style in styles) {
                    helpVars += `        --${style}: ${styles[style]};\n`;
                }
                helpVars += '    }\n';
                helpVars += '</style>\n';
            }

            if (response.includes('<head>')) {
                response = response.replace(
                    '<head>',
                    `<head>\n${helpVars}\n${styleDefaults || ''}`
                );

                response = response.replace(
                    '</head>',
                    `${styleOverrides || ''}\n${script || ''}\n</head>`
                );
            } else {
                response = `${helpVars}${styleDefaults || ''}${styleOverrides || ''}${script || ''}${response}`;
            }
        }

        response = rewriteUrlsWithProxyPath(response, proxyPath);
        return Buffer.from(response, 'utf8');
    }
}

function rewriteUrlsWithProxyPath(content: string, proxyPath: string): string {
    if (!proxyPath || proxyPath === '/') {
        return content;
    }

    return content.replace(
        /(src|href)="\/(?!\/)([^"]+)"/g,
        (match, p1, p2) => {
            const matchedPath = `/${p2}`;
            if (matchedPath.startsWith(proxyPath)) {
                return match;
            }
            return `${p1}="${proxyPath}/${p2}"`;
        }
    );
}
