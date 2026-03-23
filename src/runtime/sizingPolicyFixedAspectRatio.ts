/**
 * Base class for fixed aspect ratio sizing policies.
 * This is used as a base class for Square, Landscape, Portrait policies.
 *
 * Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

import { IPlotSize } from './sizingPolicy';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed
 * aspect ratio. It isn't directly exposed to the user, but is used as a base
 * class for a handful of other policies (landscape, portrait, square, etc.)
 */
export class SizingPolicyFixedAspectRatio {
    private static minimumPlotSize = 400;

    constructor(public readonly aspectRatio: number) { }

    /**
     * Computes the size of the plot in pixels, given the size of the viewport in pixels.
     *
     * @param viewportSize The size of the viewport in pixels.
     * @returns The size of the plot in pixels.
     */
    public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
        let plotWidth = Math.max(viewportSize.width, SizingPolicyFixedAspectRatio.minimumPlotSize);
        let plotHeight = Math.max(viewportSize.height, SizingPolicyFixedAspectRatio.minimumPlotSize);
        if (plotWidth / plotHeight > this.aspectRatio) {
            plotWidth = plotHeight * this.aspectRatio;
        } else {
            plotHeight = plotWidth / this.aspectRatio;
        }
        return { width: plotWidth, height: plotHeight };
    }
}
