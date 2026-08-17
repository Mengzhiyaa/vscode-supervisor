/** The decoded contents of an image data URL. */
export interface DecodedImageData {
    mimeType: string;
    bytes: Uint8Array;
}

/**
 * Decode a data URL produced by the plot clients.
 * Supports both base64 encoded binary images and percent-encoded text (SVG).
 */
export function decodeImageDataUrl(
    value: string,
    fallbackMime = 'image/png',
): DecodedImageData {
    if (!value.startsWith('data:')) {
        throw new Error('Expected a data URL');
    }

    const comma = value.indexOf(',');
    if (comma < 0) {
        throw new Error('Malformed data URL');
    }

    const metadata = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const parts = metadata.split(';');
    const mimeType = (parts[0] || fallbackMime).toLowerCase();

    if (parts.includes('base64')) {
        return { mimeType, bytes: Buffer.from(payload, 'base64') };
    }

    return {
        mimeType,
        bytes: new TextEncoder().encode(decodeURIComponent(payload)),
    };
}

/** Return a conventional file extension for an image MIME type. */
export function extensionForMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
        case 'image/svg+xml':
            return 'svg';
        case 'image/jpeg':
            return 'jpg';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        case 'image/png':
        default:
            return 'png';
    }
}

/** Read the MIME type from a data URL, falling back when the URL is absent. */
export function mimeTypeFromDataUrl(value: string, fallbackMime = 'image/png'): string {
    if (!value.startsWith('data:')) {
        return fallbackMime;
    }
    const comma = value.indexOf(',');
    if (comma < 0) {
        return fallbackMime;
    }
    const mimeType = value.slice(5, comma).split(';')[0].toLowerCase();
    return mimeType || fallbackMime;
}
