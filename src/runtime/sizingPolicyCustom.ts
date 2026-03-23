/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { PlotClientInstance } from './PlotClientInstance';

/**
 * The custom sizing policy. The plot is given a fixed size, specified by the
 * user, in pixels. The viewport size is ignored.
 *
 * Matches Positron's PlotSizingPolicyCustom class.
 */
export class PlotSizingPolicyCustom implements IPositronPlotSizingPolicy {
    public static ID = 'custom';

    public readonly id = PlotSizingPolicyCustom.ID;
    private readonly _name: string;

    constructor(public readonly size: IPlotSize, slow: boolean = false) {
        const name = slow
            ? `${size.width}×${size.height} (frozen)`
            : `${size.width}×${size.height} (custom)`;

        this._name = name;
    }

    public getName(plot: PlotClientInstance): string {
        return this._name;
    }

    public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
        return this.size;
    }
}
