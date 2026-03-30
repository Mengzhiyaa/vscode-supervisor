import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webviewRoot = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = 4173;

const mimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.map', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml; charset=utf-8'],
    ['.ttf', 'font/ttf'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.wasm', 'application/wasm'],
]);

function resolvePath(urlPath) {
    const normalized = decodeURIComponent(urlPath.split('?')[0]);
    const withoutLeadingSlash = normalized.replace(/^\/+/, '');
    const candidate = path.resolve(webviewRoot, withoutLeadingSlash || 'index.html');
    if (!candidate.startsWith(webviewRoot)) {
        return null;
    }
    return candidate;
}

function send(res, statusCode, body, headers = {}) {
    res.writeHead(statusCode, headers);
    res.end(body);
}

const server = createServer((req, res) => {
    const resolvedPath = resolvePath(req.url ?? '/');
    if (!resolvedPath) {
        send(res, 403, 'Forbidden');
        return;
    }

    let filePath = resolvedPath;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        send(res, 404, 'Not Found');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes.get(ext) ?? 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    send(res, 200, content, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
    });
});

server.listen(port, host, () => {
    process.stdout.write(`webview test server listening on http://${host}:${port}\n`);
});
