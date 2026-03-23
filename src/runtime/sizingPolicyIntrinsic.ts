/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { PlotClientInstance } from './PlotClientInstance';
import type { IntrinsicSize } from './comms/positronPlotComm';
import { PlotUnit } from './comms/positronPlotComm';

/**
 * This sizing policy does not provide a size for the plot; the language runtime will use the
 * intrinsic size of the plot, if it is known.
 *
 * Matches Positron's PlotSizingPolicyIntrinsic class.
 */
export class PlotSizingPolicyIntrinsic implements IPositronPlotSizingPolicy {
    public static ID = 'intrinsic';

    public readonly id = PlotSizingPolicyIntrinsic.ID;

    private readonly _name = 'Intrinsic';

    public getName(plot?: PlotClientInstance): string {
        if (!plot) {
            return this._name;
        }

        const intrinsicSize = plot.intrinsicSize;

        if (!intrinsicSize) {
            return this._name;
        }

        return `${intrinsicSize.source} (${intrinsicSize.width}${formatPlotUnit(intrinsicSize.unit)}×${intrinsicSize.height}${formatPlotUnit(intrinsicSize.unit)})`;
    }

    public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
        // Don't specify a size; the language runtime will use the intrinsic size of the plot.
        return undefined;
    }
}

/**
 * Determine the user-facing unit of measurement.
 *
 * @param unit The unit of measurement.
 */
export function formatPlotUnit(unit: PlotUnit): string {
    switch (unit) {
        case PlotUnit.Inches:
            return 'in';
        case PlotUnit.Pixels:
            return 'px';
        default:
            throw new Error(`Unknown plot unit: ${unit}`);
    }
}
