import * as assert from 'assert';
import {
    isLocalhostUrl,
    shouldOpenUrlInViewer,
} from '../../services/preview/previewUrlPolicy';

suite('[Unit] viewer URL policy', () => {
    test('embeds localhost and loopback URLs when enabled', () => {
        for (const url of [
            'http://localhost:8787',
            'http://127.0.0.1:3000',
            'http://[::1]:8000',
        ]) {
            assert.strictEqual(isLocalhostUrl(url), true, url);
            assert.strictEqual(shouldOpenUrlInViewer(url, true), true, url);
        }
    });

    test('routes non-local HTTP URLs to the external browser', () => {
        assert.strictEqual(shouldOpenUrlInViewer('https://example.com/app', true), false);
        assert.strictEqual(shouldOpenUrlInViewer('https://app.localhost/app', true), false);
        assert.strictEqual(shouldOpenUrlInViewer('http://127.0.0.2/app', true), false);
        assert.strictEqual(shouldOpenUrlInViewer('http://192.168.1.20/app', true), false);
    });

    test('honors the localhost setting without blocking local HTML files', () => {
        assert.strictEqual(shouldOpenUrlInViewer('http://localhost:8787', false), false);
        assert.strictEqual(shouldOpenUrlInViewer('file:///tmp/report.html', false), false);
    });
});
