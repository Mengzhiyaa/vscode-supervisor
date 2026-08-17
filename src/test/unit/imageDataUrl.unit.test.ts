import * as assert from 'assert';
import {
    decodeImageDataUrl,
    extensionForMimeType,
} from '../../runtime/imageDataUrl';

suite('[Unit] image data URL helpers', () => {
    test('decodes UTF-8 SVG data URLs', () => {
        const decoded = decodeImageDataUrl(
            'data:image/svg+xml,%3Csvg%3E%E4%B8%AD%3C%2Fsvg%3E',
        );
        assert.strictEqual(decoded.mimeType, 'image/svg+xml');
        assert.match(new TextDecoder().decode(decoded.bytes), /中/);
        assert.strictEqual(extensionForMimeType(decoded.mimeType), 'svg');
    });

    test('decodes base64 PNG data URLs and rejects malformed values', () => {
        const decoded = decodeImageDataUrl('data:image/png;base64,SGVsbG8=');
        assert.deepStrictEqual([...decoded.bytes], [...Buffer.from('Hello')]);
        assert.throws(() => decodeImageDataUrl('not-a-data-url'), /data URL/);
        assert.throws(() => decodeImageDataUrl('data:image/png'), /Malformed/);
    });
});
