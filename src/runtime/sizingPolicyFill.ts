/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { PlotClientInstance } from './PlotClientInstance';

/**
 * The fill sizing policy. The plot completely fills the viewport.
 *
 * Matches Positron's PlotSizingPolicyFill class.
 */
export class PlotSizingPolicyFill implements IPositronPlotSizingPolicy {
    public static ID = 'fill';

    public readonly id = PlotSizingPolicyFill.ID;
    private readonly _name = 'Fill';

    public getName(plot: PlotClientInstance): string {
        return this._name;
    }

    public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
        return {
            width: Math.floor(viewportSize.width),
            height: Math.floor(viewportSize.height)
        };
    }
}
