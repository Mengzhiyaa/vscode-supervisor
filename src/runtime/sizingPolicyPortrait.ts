/**
 * Portrait sizing policy - sizes the plot to a 3:4 aspect ratio.
 *
 * Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

import { IPositronPlotSizingPolicy } from './sizingPolicy';
import { SizingPolicyFixedAspectRatio } from './sizingPolicyFixedAspectRatio';
import { PlotClientInstance } from './PlotClientInstance';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 3:4
 * (portrait) aspect ratio.
 */
export class PlotSizingPolicyPortrait
    extends SizingPolicyFixedAspectRatio
    implements IPositronPlotSizingPolicy {

    constructor() {
        super(3 / 4);
    }

    public readonly id = 'portrait';
    private readonly _name = 'Portrait';

    public getName(plot?: PlotClientInstance): string {
        return this._name;
    }
}
