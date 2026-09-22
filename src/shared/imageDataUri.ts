/** Image encoding shared by the extension host and browser Webviews. */
export interface DecodedImage {
    readonly mimeType: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
}

export function decodeImageDataUri(uri: string): DecodedImage {
    const comma = uri.indexOf(',');
    const header = uri.slice(0, comma).split(';');
    const mime = /^data:(image\/[a-z0-9!#$&^_.+-]+)$/i.exec(header[0]);
    if (comma < 0 || !mime) {
        throw new Error('Invalid image data URI');
    }

    const payload = uri.slice(comma + 1);
    if (header.slice(1).some(parameter => parameter.toLowerCase() === 'base64')) {
        // atob rejects malformed base64 consistently in Node and browsers.
        const binary = atob(decodeURIComponent(payload));
        return {
            mimeType: mime[1].toLowerCase(),
            bytes: Uint8Array.from(binary, character => character.charCodeAt(0)),
        };
    }

    // Decode percent escapes as bytes, not Unicode code points. This also
    // preserves non-UTF-8 binary images and unescaped Unicode SVG text.
    const encoded = new TextEncoder().encode(payload);
    const bytes = new Uint8Array(encoded.length);
    let length = 0;
    for (let index = 0; index < encoded.length; index++) {
        if (encoded[index] !== 0x25) {
            bytes[length++] = encoded[index];
            continue;
        }
        const hex = String.fromCharCode(encoded[index + 1], encoded[index + 2]);
        if (!/^[0-9a-f]{2}$/i.test(hex)) {
            throw new Error('Invalid percent encoding in image data URI');
        }
        bytes[length++] = parseInt(hex, 16);
        index += 2;
    }
    return { mimeType: mime[1].toLowerCase(), bytes: bytes.slice(0, length) };
}

export function imageExtension(mimeType: string): string {
    mimeType = mimeType.toLowerCase();
    switch (mimeType) {
        case 'image/svg+xml': return 'svg';
        case 'image/jpeg': return 'jpg';
        case 'image/x-icon':
        case 'image/vnd.microsoft.icon': return 'ico';
        case 'image/tiff': return 'tiff';
        default: return mimeType.slice('image/'.length).split('+')[0];
    }
}

export function imageFileName(mimeType: string, fallback: string, suggested?: string): string {
    const extension = imageExtension(mimeType);
    const name = (suggested || fallback).split(/[\\/]/).pop()!
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .replace(/[. ]+$/, '');
    const stem = name.replace(/\.(png|jpe?g|svg|gif|webp|avif|bmp|ico|tiff?)$/i, '') || 'plot';
    return `${stem}.${extension}`;
}
