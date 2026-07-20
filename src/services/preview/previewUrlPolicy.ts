export function isLocalhostUrl(value: string): boolean {
    try {
        const url = new URL(value);
        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
        return false;
    }
}

export function shouldOpenUrlInViewer(value: string, openLocalhostUrls: boolean): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') &&
            openLocalhostUrls &&
            isLocalhostUrl(value);
    } catch {
        return true;
    }
}
