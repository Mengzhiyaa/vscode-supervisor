<script lang="ts">
    /**
     * ZoomPlotMenuButton component.
     * A menu button for selecting the plot zoom level.
     * Matches Positron's ZoomPlotMenuButton component.
     *
     * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
     * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
     */

    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import { ZoomLevel } from "./types";

    interface Props {
        /** Current zoom level */
        zoomLevel: ZoomLevel;
        onZoomChange?: (zoomLevel: ZoomLevel) => void;
    }

    let { zoomLevel, onZoomChange }: Props = $props();

    // Zoom level labels matching Positron's zoomLevelMap
    const zoomLevelMap = new Map<ZoomLevel, string>([
        [ZoomLevel.Fit, "Fit"],
        [ZoomLevel.Fifty, "50%"],
        [ZoomLevel.SeventyFive, "75%"],
        [ZoomLevel.OneHundred, "100%"],
        [ZoomLevel.TwoHundred, "200%"],
    ]);

    // All available zoom levels
    const zoomLevels: ZoomLevel[] = [
        ZoomLevel.Fit,
        ZoomLevel.Fifty,
        ZoomLevel.SeventyFive,
        ZoomLevel.OneHundred,
        ZoomLevel.TwoHundred,
    ];

    // Localized strings
    const zoomPlotTooltip = "Set the plot zoom";

    // Active zoom label
    const activeZoomLabel = $derived(zoomLevelMap.get(zoomLevel) || "Fit");
</script>

<ActionBarMenuButton
    icon="positron-size-to-fit"
    buttonClass="plot-compact-menu-button"
    label={activeZoomLabel}
    tooltip={zoomPlotTooltip}
    ariaLabel={zoomPlotTooltip}
    actions={() =>
        zoomLevels.map((level) => ({
            id: String(level),
            label: zoomLevelMap.get(level) ?? "Fit",
            checked: level === zoomLevel,
            onSelected: () => {
                onZoomChange?.(level);
            },
        }))
    }
/>
