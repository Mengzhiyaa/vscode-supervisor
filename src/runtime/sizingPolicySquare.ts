/**
 * Square sizing policy - sizes the plot to a 1:1 aspect ratio.
 *
 * Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

import { IPositronPlotSizingPolicy } from './sizingPolicy';
import { SizingPolicyFixedAspectRatio } from './sizingPolicyFixedAspectRatio';
import { PlotClientInstance } from './PlotClientInstance';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 1:1
 * (square) aspect ratio.
 */
export class PlotSizingPolicySquare
    extends SizingPolicyFixedAspectRatio
    implements IPositronPlotSizingPolicy {

    constructor() {
        super(1);
    }

    public readonly id = 'square';
    private readonly _name = 'Square';

    public getName(plot?: PlotClientInstance): string {
        return this._name;
    }
}
