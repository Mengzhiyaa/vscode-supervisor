/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';
import { RuntimeClientInstance } from '../RuntimeClientInstance';
import {
    IntrinsicSize,
    PlotMetadata,
    PlotRenderFormat,
    PlotResult,
    PlotSize,
    UpdateEvent,
    ShowEvent,
    PlotBackendRequest
} from './positronPlotComm';

/**
 * PositronPlotComm is a comm interface for plot communication.
 * This class extends PositronBaseComm and provides typed RPC methods
 * for plot-related operations.
 *
 * Matches Positron's auto-generated PositronPlotComm class.
 */
export class PositronPlotCommClass extends PositronBaseComm {
    /**
     * Event that fires when the plot has been updated on the backend.
     */
    public readonly onDidUpdate: vscode.Event<UpdateEvent>;

    /**
     * Event that fires when the plot should be shown.
     */
    public readonly onDidShow: vscode.Event<ShowEvent>;

    constructor(
        instance: RuntimeClientInstance,
        options?: PositronCommOptions<PlotBackendRequest>
    ) {
        super(instance, options);

        // Create event emitters for plot events
        this.onDidUpdate = this.createEventEmitter<UpdateEvent>('update', ['pre_render']);
        this.onDidShow = this.createEventEmitter<ShowEvent>('show', []);
    }

    /**
     * Get the intrinsic size of a plot, if known.
     *
     * The intrinsic size of a plot is the size at which a plot would be if
     * no size constraints were applied by Positron.
     *
     * @returns The intrinsic size of a plot, if known
     */
    async getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
        try {
            const result = await this.performRpc<IntrinsicSize | null>(
                'get_intrinsic_size',
                [],
                []
            );
            return result ?? undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Get metadata for the plot
     *
     * @returns The plot's metadata
     */
    async getMetadata(): Promise<PlotMetadata> {
        return this.performRpc<PlotMetadata>('get_metadata', [], []);
    }

    /**
     * Render a plot
     *
     * Requests a plot to be rendered. The plot data is returned in a
     * base64-encoded string.
     *
     * @param size The requested size of the plot. If not provided, the plot
     *   will be rendered at its intrinsic size.
     * @param pixelRatio The pixel ratio of the display device
     * @param format The requested plot format
     *
     * @returns A rendered plot
     */
    async render(
        size: PlotSize | undefined,
        pixelRatio: number,
        format: PlotRenderFormat
    ): Promise<PlotResult> {
        return this.performRpc<PlotResult>(
            'render',
            ['size', 'pixel_ratio', 'format'],
            [size, pixelRatio, format]
        );
    }
}
