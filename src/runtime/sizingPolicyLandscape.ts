/**
 * Landscape sizing policy - sizes the plot to a 4:3 aspect ratio.
 *
 * Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

import { IPositronPlotSizingPolicy } from './sizingPolicy';
import { SizingPolicyFixedAspectRatio } from './sizingPolicyFixedAspectRatio';
import { PlotClientInstance } from './PlotClientInstance';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 4:3
 * (landscape) aspect ratio.
 */
export class PlotSizingPolicyLandscape
    extends SizingPolicyFixedAspectRatio
    implements IPositronPlotSizingPolicy {

    constructor() {
        super(4 / 3);
    }

    public readonly id = 'landscape';
    private readonly _name = 'Landscape';

    public getName(plot?: PlotClientInstance): string {
        return this._name;
    }
}
