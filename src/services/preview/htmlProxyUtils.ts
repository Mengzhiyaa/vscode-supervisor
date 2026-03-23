const ROOT_RELATIVE_ATTRIBUTE_PATTERN = /\b(src|href|action|poster)=(["'])\/([^"']+)\2/g;

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
