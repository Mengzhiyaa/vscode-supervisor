import * as assert from 'assert';
import {
    createSelectedPlotChangedPayload,
    serializePlotRecord,
    toPlotAddedParams,
} from '../../webview/plotsPayload';

suite('[Unit] plots payload helpers', () => {
    test('serializePlotRecord clones customSize', () => {
        const customSize = { width: 640, height: 480 };

        const serialized = serializePlotRecord(
            {
                id: 'plot-1',
                renderVersion: 2,
                sessionId: 'session-1',
                kind: 'static',
                zoomLevel: 1,
                sizingPolicyId: 'custom',
                customSize,
                hasIntrinsicSize: true,
            },
            {
                thumbnail: 'thumb://plot-1',
                initialData: 'data:image/png;base64,abc',
                initialRenderSettings: { width: 800, height: 600, pixelRatio: 2 },
            },
        );

        assert.deepStrictEqual(serialized.customSize, { width: 640, height: 480 });
        assert.notStrictEqual(serialized.customSize, customSize);

        customSize.width = 320;
        assert.deepStrictEqual(serialized.customSize, { width: 640, height: 480 });
    });

    test('toPlotAddedParams maps id to plotId and preserves renderVersion', () => {
        const params = toPlotAddedParams({
            id: 'plot-2',
            thumbnail: 'thumb://plot-2',
            initialData: 'data:image/png;base64,def',
            initialRenderSettings: { width: 640, height: 480, pixelRatio: 1 },
            renderVersion: 7,
            sessionId: 'session-2',
            kind: 'dynamic',
            zoomLevel: 0,
            sizingPolicyId: 'auto',
        });

        assert.strictEqual(params.plotId, 'plot-2');
        assert.strictEqual(params.renderVersion, 7);
        assert.strictEqual((params as { id?: string }).id, undefined);
    });

    test('createSelectedPlotChangedPayload clones customSize', () => {
        const customSize = { width: 500, height: 300 };

        const payload = createSelectedPlotChangedPayload({
            plotId: 'plot-3',
            selectedSizingPolicyId: 'custom',
            sizingPolicies: [{ id: 'custom', name: 'Custom' }],
            customSize,
            hasIntrinsicSize: false,
            zoomLevel: 1,
        });

        assert.deepStrictEqual(payload.customSize, { width: 500, height: 300 });
        assert.notStrictEqual(payload.customSize, customSize);

        customSize.height = 200;
        assert.deepStrictEqual(payload.customSize, { width: 500, height: 300 });
    });
});
