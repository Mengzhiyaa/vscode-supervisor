const ROOT_RELATIVE_ATTRIBUTE_PATTERN = /\b(src|href|action|poster)=(["'])\/([^"']+)\2/g;

export const VIEWER_BRIDGE_PATH = '/.supervisor/viewer-bridge.js';

export const VIEWER_BRIDGE_SCRIPT = String.raw`
(() => {
    const send = (id, data = {}) => window.parent.postMessage({ id, ...data }, '*');
    const notifyLocation = () => send('supervisor-viewer-location', {
        url: window.location.href,
        title: document.title
    });

    window.addEventListener('message', event => {
        const data = event.data || {};
        if (data.id === 'supervisor-viewer-ping') {
            send('supervisor-viewer-ready');
        } else if (data.id === 'supervisor-viewer-focus') {
            window.focus();
        } else if (data.id === 'supervisor-viewer-find') {
            window.getSelection()?.removeAllRanges();
            const found = data.value
                ? window.find(data.value, false, false, true, false, false, false)
                : true;
            send('supervisor-viewer-find-result', { found });
        } else if (data.id === 'supervisor-viewer-find-next' && data.value) {
            send('supervisor-viewer-find-result', {
                found: window.find(data.value, false, false, true, false, false, false)
            });
        } else if (data.id === 'supervisor-viewer-find-previous' && data.value) {
            send('supervisor-viewer-find-result', {
                found: window.find(data.value, false, true, true, false, false, false)
            });
        }
    });

    document.addEventListener('click', event => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link || link.hasAttribute('download') || link.target === '_blank') {
            return;
        }
        const href = link.href;
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) {
            return;
        }
        event.preventDefault();
        send('supervisor-viewer-navigate', { url: href });
    }, true);

    window.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            send('supervisor-viewer-show-find');
        }
    }, true);

    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            queueMicrotask(notifyLocation);
            return result;
        };
    }
    window.addEventListener('popstate', notifyLocation);
    window.addEventListener('hashchange', notifyLocation);
    window.addEventListener('DOMContentLoaded', () => {
        send('supervisor-viewer-ready');
        notifyLocation();
    }, { once: true });
})();
`;

export function normalizeProxyPath(proxyPath: string): string {
    if (!proxyPath || proxyPath === '/') {
        return '/';
    }

    const withLeadingSlash = proxyPath.startsWith('/') ? proxyPath : `/${proxyPath}`;
    return withLeadingSlash.endsWith('/')
        ? withLeadingSlash.slice(0, -1)
        : withLeadingSlash;
}

export function buildProxyPath(basePath: string, targetPath: string): string {
    const normalizedBasePath = normalizeProxyPath(basePath);
    const normalizedTargetPath = targetPath
        ? (targetPath.startsWith('/') ? targetPath : `/${targetPath}`)
        : '/';

    if (normalizedBasePath === '/') {
        return normalizedTargetPath;
    }

    return normalizedTargetPath === '/'
        ? `${normalizedBasePath}/`
        : `${normalizedBasePath}${normalizedTargetPath}`;
}

export function isHtmlContentType(contentType: string | undefined): boolean {
    return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

export function rewriteRootRelativeUrls(content: string, proxyPath: string): string {
    const normalizedProxyPath = normalizeProxyPath(proxyPath);
    if (normalizedProxyPath === '/') {
        return content;
    }

    return content.replace(
        ROOT_RELATIVE_ATTRIBUTE_PATTERN,
        (match, attribute: string, quote: string, targetPath: string) => {
            const matchedPath = `/${targetPath}`;
            if (matchedPath.startsWith(`${normalizedProxyPath}/`)) {
                return match;
            }

            return `${attribute}=${quote}${buildProxyPath(normalizedProxyPath, matchedPath)}${quote}`;
        }
    );
}

export function injectViewerBridge(content: string, proxyPath: string): string {
    if (content.includes('data-supervisor-viewer-bridge')) {
        return content;
    }
    const scriptPath = buildProxyPath(proxyPath, VIEWER_BRIDGE_PATH);
    const script = `<script data-supervisor-viewer-bridge src="${scriptPath}"></script>`;
    const bodyEnd = content.search(/<\/body\s*>/i);
    if (bodyEnd >= 0) {
        return `${content.slice(0, bodyEnd)}${script}${content.slice(bodyEnd)}`;
    }
    return `${content}${script}`;
}

export function rewriteProxyLocation(
    location: string,
    targetOrigin: string,
    proxyPath: string
): string {
    if (!location || (!location.startsWith('/') && !hasScheme(location))) {
        return location;
    }

    try {
        const target = new URL(targetOrigin);
        const resolved = new URL(location, target);
        if (resolved.origin !== target.origin) {
            return location;
        }

        return `${buildProxyPath(proxyPath, resolved.pathname)}${resolved.search}${resolved.hash}`;
    } catch {
        return location;
    }
}

export function buildWebSocketTargetUrl(targetOrigin: string, requestPath: string): string {
    const target = new URL(targetOrigin);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';

    const resolved = new URL(requestPath || '/', target);
    resolved.protocol = target.protocol;
    return resolved.toString();
}

function hasScheme(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}
