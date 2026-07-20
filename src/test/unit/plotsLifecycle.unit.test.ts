import * as assert from 'assert';
import * as vscode from 'vscode';
import { shouldFreezeSlowPlot } from '../../runtime/PlotClientInstance';
import { HtmlPlotClient } from '../../runtime/htmlPlotClient';
import {
    PositronPlotsService,
    resolveInitialPlotSizingPolicy,
} from '../../runtime/positronPlotsService';
import { PlotSizingPolicyAuto } from '../../runtime/sizingPolicyAuto';
import { PlotSizingPolicyIntrinsic } from '../../runtime/sizingPolicyIntrinsic';
import { PlotSizingPolicySquare } from '../../runtime/sizingPolicySquare';

suite('[Unit] Plot resource and sizing lifecycle', () => {
    test('hibernates the least recently selected HTML plot above the active limit', () => {
        const service = new PositronPlotsService();
        for (let index = 0; index < 6; index++) {
            service.addHtmlPlot('session-1', {
                uri: vscode.Uri.parse(`https://localhost/plot-${index}`),
                title: `Plot ${index}`,
            });
        }
        const plots = service.positronPlotInstances.filter(
            (plot): plot is HtmlPlotClient => plot instanceof HtmlPlotClient,
        );
        plots.forEach((plot, index) => {
            service.markHtmlPlotSelected(plot.id);
            plot.claim({ index });
        });

        assert.strictEqual(plots.filter(plot => plot.isActive).length, 5);
        assert.strictEqual(plots[0]?.isActive, false);
        assert.strictEqual(plots.at(-1)?.isActive, true);
        service.dispose();
    });

    test('freezes only a first render slower than three seconds with a known size', () => {
        assert.strictEqual(shouldFreezeSlowPlot(true, {
            renderTimeMs: 3001,
            size: { width: 640, height: 480 },
        }, true), true);
        assert.strictEqual(shouldFreezeSlowPlot(false, {
            renderTimeMs: 5000,
            size: { width: 640, height: 480 },
        }, true), false);
        assert.strictEqual(shouldFreezeSlowPlot(true, {
            renderTimeMs: 5000,
            size: undefined,
        }, true), false);
        assert.strictEqual(shouldFreezeSlowPlot(true, {
            renderTimeMs: 5000,
            size: { width: 640, height: 480 },
        }, false), false);
    });

    test('uses intrinsic for Python Auto and switches non-Python only when intrinsic arrives', () => {
        const auto = new PlotSizingPolicyAuto();
        const intrinsic = new PlotSizingPolicyIntrinsic();
        const square = new PlotSizingPolicySquare();
        const policies = [auto, intrinsic, square];

        assert.strictEqual(resolveInitialPlotSizingPolicy({ language: 'python' }, policies, auto), intrinsic);
        assert.strictEqual(resolveInitialPlotSizingPolicy({ language: 'r' }, policies, auto), auto);
        assert.strictEqual(resolveInitialPlotSizingPolicy({
            language: 'python',
            sizing_policy: { id: square.id },
        }, policies, auto), square);
    });
});
