<!--
  ActionBar.svelte
  Plots panel action bar — uses DynamicActionBar for overflow support.
  Mirrors: positron/positronPlots/browser/components/actionBars.tsx
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import DynamicActionBar, {
        type DynamicAction,
    } from "../shared/DynamicActionBar.svelte";
    import {
        ZoomLevel,
        DarkFilter,
        type IPositronPlotSizingPolicy,
        type EditorTarget,
    } from "./types";
    import SizingPolicyMenuButton from "./SizingPolicyMenuButton.svelte";
    import ZoomPlotMenuButton from "./ZoomPlotMenuButton.svelte";
    import DarkFilterMenuButton from "./DarkFilterMenuButton.svelte";
    import OpenInEditorMenuButton from "./OpenInEditorMenuButton.svelte";
    import PlotCodeMenuButton from "./PlotCodeMenuButton.svelte";

    type OpenInEditorTarget = "editorTab" | "editorTabSide" | "newWindow";

    interface Props {
        plotCount: number;
        currentIndex: number;
        hasPlots: boolean;
        openInEditorDefaultTarget?: EditorTarget;
        selectedPlotKind?: "static" | "dynamic" | "html";
        zoomLevel: ZoomLevel;
        darkFilterMode: DarkFilter;
        selectedSizingPolicy?: IPositronPlotSizingPolicy;
        sizingPolicies?: IPositronPlotSizingPolicy[];
        hasIntrinsicSize?: boolean;
        customSize?: { width: number; height: number };
        selectedPlotCode?: string;
        selectedPlotExecutionId?: string;
        selectedPlotSessionId?: string;
        selectedPlotLanguageId?: string;
        selectedPlotHasOriginFile?: boolean;
    }

    let {
        plotCount,
        currentIndex,
        hasPlots,
        openInEditorDefaultTarget = "activeGroup",
        selectedPlotKind,
        zoomLevel,
        darkFilterMode,
        selectedSizingPolicy,
        sizingPolicies = [],
        hasIntrinsicSize = false,
        customSize,
        selectedPlotCode,
        selectedPlotExecutionId,
        selectedPlotSessionId,
        selectedPlotLanguageId,
        selectedPlotHasOriginFile = false,
    }: Props = $props();

    const dispatch = createEventDispatcher<{
        previous: void;
        next: void;
        save: void;
        copy: void;
        zoomChange: { zoomLevel: ZoomLevel };
        darkFilterChange: { mode: DarkFilter };
        selectSizingPolicy: { policyId: string };
        setCustomSize: void;
        clearAll: void;
        openInEditor: { target: OpenInEditorTarget };
        popoutPlot: void;
        revealPlotCodeInConsole: { sessionId: string; executionId: string };
        runPlotCodeAgain: {
            code: string;
            sessionId: string;
            languageId: string;
        };
        openSourceFile: void;
        openGalleryInNewWindow: void;
        openDarkFilterSettings: void;
    }>();

    const showPreviousPlot = "Show previous plot";
    const showNextPlot = "Show next plot";
    const savePlot = "Save plot";
    const copyPlotToClipboard = "Copy plot to clipboard";
    const openPlotInNewWindow = "Open plot in new window";
    const openPlotsGalleryInNewWindow = "Open plots gallery in new window";
    const clearAllPlots = "Clear all plots";
    const plotIconButtonWidth = 18;
    const plotSeparatorWidth = 5;

    const isDynamicPlot = $derived(selectedPlotKind === "dynamic");
    const isStaticPlot = $derived(selectedPlotKind === "static");
    const isHtmlPlot = $derived(selectedPlotKind === "html");
    const enableSizingPolicy = $derived(hasPlots && isDynamicPlot);
    const enableImagePlotActions = $derived(
        hasPlots && (isDynamicPlot || isStaticPlot),
    );
    const enableSavingPlots = $derived(enableImagePlotActions);
    const enableCopyPlot = $derived(enableImagePlotActions);
    const enableZoomPlot = $derived(enableImagePlotActions);
    const enableEditorPlot = $derived(enableImagePlotActions);
    const enableDarkFilter = $derived(enableCopyPlot);
    const enablePopoutPlot = $derived(hasPlots && isHtmlPlot);
    const enableCodeActions = $derived(hasPlots && !!selectedPlotCode);
    const zoomLevelLabels = new Map<ZoomLevel, string>([
        [ZoomLevel.Fit, "Fit"],
        [ZoomLevel.Fifty, "50%"],
        [ZoomLevel.SeventyFive, "75%"],
        [ZoomLevel.OneHundred, "100%"],
        [ZoomLevel.TwoHundred, "200%"],
    ]);

    const selectedSizingPolicySafe = $derived(
        selectedSizingPolicy ?? {
            id: "auto",
            getName: () => "Auto",
            getPlotSize: () => undefined,
        },
    );
    const activeZoomLabel = $derived(
        zoomLevelLabels.get(zoomLevel) ?? "Fit",
    );
    const activeSizingPolicyLabel = $derived(
        selectedSizingPolicySafe.getName(),
    );

    function handlePrevious() { dispatch("previous"); }
    function handleNext() { dispatch("next"); }
    function handleSave() { dispatch("save"); }
    function handleCopy() { dispatch("copy"); }
    function handleZoomChange(event: CustomEvent<{ zoomLevel: ZoomLevel }>) {
        dispatch("zoomChange", { zoomLevel: event.detail.zoomLevel });
    }
    function handleDarkFilterChange(event: CustomEvent<{ mode: DarkFilter }>) {
        dispatch("darkFilterChange", { mode: event.detail.mode });
    }
    function handleSizingPolicySelect(event: CustomEvent<{ policyId: string }>) {
        dispatch("selectSizingPolicy", { policyId: event.detail.policyId });
    }
    function handleCustomSize() { dispatch("setCustomSize"); }
    function handleClearAll() { dispatch("clearAll"); }

    function mapEditorTarget(target: EditorTarget): OpenInEditorTarget {
        switch (target) {
            case "sideGroup": return "editorTabSide";
            case "newWindow": return "newWindow";
            case "activeGroup":
            default: return "editorTab";
        }
    }

    function handleOpenInEditor(target: EditorTarget) {
        dispatch("openInEditor", { target: mapEditorTarget(target) });
    }

    function handlePopoutPlot() { dispatch("popoutPlot"); }

    function handleCopyPlotCode(code: string) {
        if (!code) return;
        void navigator.clipboard.writeText(code).catch((error) => {
            console.warn("Failed to copy plot code:", error);
        });
    }

    function handleRevealPlotCodeInConsole(data: { sessionId: string; executionId: string }) {
        dispatch("revealPlotCodeInConsole", data);
    }

    function handleRunPlotCodeAgain(data: { code: string; sessionId: string; languageId: string }) {
        dispatch("runPlotCodeAgain", data);
    }

    function handleOpenSourceFile() {
        dispatch("openSourceFile");
    }

    function handleOpenGalleryInNewWindow() { dispatch("openGalleryInNewWindow"); }

    function getOpenInEditorTooltip(target: EditorTarget): string {
        switch (target) {
            case "sideGroup": return "Open in editor tab to the Side";
            case "newWindow": return "Open in new window";
            case "activeGroup":
            default: return "Open in editor tab";
        }
    }

    // --- Build DynamicActionBar actions ---
    const leftActions: DynamicAction[] = $derived.by(() => {
        const actions: DynamicAction[] = [
            {
                fixedWidth: plotIconButtonWidth,
                separator: false,
                component: prevSnippet,
            },
            {
                fixedWidth: plotIconButtonWidth,
                separator: hasPlots,
                component: nextSnippet,
            },
        ];

        // Only show content actions if there are plots
        if (hasPlots) {
            if (enableSavingPlots) {
                actions.push({
                    fixedWidth: plotIconButtonWidth,
                    separator: false,
                    component: saveSnippet,
                    overflowMenuItem: {
                        label: savePlot,
                        icon: "positron-save",
                        onSelected: handleSave,
                    },
                });
            }
            if (enableCopyPlot) {
                actions.push({
                    fixedWidth: plotIconButtonWidth,
                    separator: false,
                    component: copySnippet,
                    overflowMenuItem: {
                        label: copyPlotToClipboard,
                        icon: "copy",
                        onSelected: handleCopy,
                    },
                });
            }
            if (enableZoomPlot) {
                actions.push({
                    fixedWidth: 32,
                    text: activeZoomLabel,
                    minWidth: 48,
                    separator: false,
                    component: zoomSnippet,
                });
            }
            if (enableSizingPolicy && sizingPolicies.length > 0) {
                actions.push({
                    fixedWidth: 32,
                    text: activeSizingPolicyLabel,
                    minWidth: 56,
                    separator: false,
                    component: sizingSnippet,
                });
            }
            if (enablePopoutPlot) {
                actions.push({
                    fixedWidth: plotIconButtonWidth,
                    separator: false,
                    component: popoutSnippet,
                    overflowMenuItem: {
                        label: openPlotInNewWindow,
                        icon: "positron-open-in-new-window",
                        onSelected: handlePopoutPlot,
                    },
                });
            }
            if (enableEditorPlot) {
                actions.push({
                    fixedWidth: 36,
                    separator: false,
                    component: openInEditorSnippet,
                });
            }
            if (enableCodeActions) {
                actions.push({
                    fixedWidth: 36,
                    separator: false,
                    component: codeMenuSnippet,
                });
            }
        }

        return actions;
    });

    const rightActions: DynamicAction[] = $derived.by(() => {
        const actions: DynamicAction[] = [];

        if (hasPlots) {
            if (enableDarkFilter) {
                actions.push({
                    fixedWidth: 36,
                    separator: true,
                    component: darkFilterSnippet,
                });
            }

            actions.push({
                fixedWidth: plotIconButtonWidth,
                separator: true,
                component: gallerySnippet,
                overflowMenuItem: {
                    label: openPlotsGalleryInNewWindow,
                    icon: "window",
                    onSelected: handleOpenGalleryInNewWindow,
                },
            });
        }

        actions.push({
            fixedWidth: plotIconButtonWidth,
            separator: false,
            component: clearAllSnippet,
            overflowMenuItem: {
                label: clearAllPlots,
                icon: "clear-all",
                disabled: !hasPlots,
                onSelected: handleClearAll,
            },
        });

        return actions;
    });
</script>

<!-- Svelte Snippets for inline action rendering -->
{#snippet prevSnippet()}
    <ActionBarButton
        icon="positron-left-arrow"
        buttonClass="plot-action-icon-button"
        ariaLabel={showPreviousPlot}
        tooltip={showPreviousPlot}
        disabled={!hasPlots || currentIndex <= 0}
        onclick={handlePrevious}
    />
{/snippet}

{#snippet nextSnippet()}
    <ActionBarButton
        icon="positron-right-arrow"
        buttonClass="plot-action-icon-button"
        ariaLabel={showNextPlot}
        tooltip={showNextPlot}
        disabled={!hasPlots || currentIndex >= plotCount - 1}
        onclick={handleNext}
    />
{/snippet}

{#snippet saveSnippet()}
    <ActionBarButton
        icon="positron-save"
        buttonClass="plot-action-icon-button"
        ariaLabel={savePlot}
        tooltip={savePlot}
        onclick={handleSave}
    />
{/snippet}

{#snippet copySnippet()}
    <ActionBarButton
        icon="copy"
        buttonClass="plot-action-icon-button"
        ariaLabel={copyPlotToClipboard}
        tooltip={copyPlotToClipboard}
        onclick={handleCopy}
    />
{/snippet}

{#snippet zoomSnippet()}
    <ZoomPlotMenuButton {zoomLevel} on:zoomChange={handleZoomChange} />
{/snippet}

{#snippet sizingSnippet()}
    <SizingPolicyMenuButton
        selectedPolicy={selectedSizingPolicySafe} policies={sizingPolicies}
        {hasIntrinsicSize} {customSize}
        on:selectPolicy={handleSizingPolicySelect}
        on:setCustomSize={handleCustomSize} />
{/snippet}

{#snippet popoutSnippet()}
    <ActionBarButton
        icon="positron-open-in-new-window"
        buttonClass="plot-action-icon-button"
        ariaLabel={openPlotInNewWindow}
        tooltip={openPlotInNewWindow}
        onclick={handlePopoutPlot}
    />
{/snippet}

{#snippet openInEditorSnippet()}
    <OpenInEditorMenuButton
        defaultTarget={openInEditorDefaultTarget}
        tooltip={getOpenInEditorTooltip(openInEditorDefaultTarget)}
        ariaLabel={getOpenInEditorTooltip(openInEditorDefaultTarget)}
        onopenInEditor={handleOpenInEditor} />
{/snippet}

{#snippet codeMenuSnippet()}
    <PlotCodeMenuButton
        hasOriginFile={selectedPlotHasOriginFile}
        plotCode={selectedPlotCode} executionId={selectedPlotExecutionId}
        sessionId={selectedPlotSessionId} languageId={selectedPlotLanguageId}
        oncopyCode={handleCopyPlotCode} onrevealInConsole={handleRevealPlotCodeInConsole}
        onrunCodeAgain={handleRunPlotCodeAgain}
        onopenSourceFile={handleOpenSourceFile} />
{/snippet}

{#snippet darkFilterSnippet()}
    <DarkFilterMenuButton
        {darkFilterMode}
        on:darkFilterChange={handleDarkFilterChange}
        on:openSettings={() => dispatch("openDarkFilterSettings")}
    />
{/snippet}

{#snippet gallerySnippet()}
    <ActionBarButton
        icon="window"
        buttonClass="plot-action-icon-button"
        ariaLabel={openPlotsGalleryInNewWindow}
        tooltip={openPlotsGalleryInNewWindow}
        onclick={handleOpenGalleryInNewWindow}
    />
{/snippet}

{#snippet clearAllSnippet()}
    <ActionBarButton
        icon="clear-all"
        buttonClass="plot-action-icon-button"
        ariaLabel={clearAllPlots}
        tooltip={clearAllPlots}
        disabled={!hasPlots}
        onclick={handleClearAll}
    />
{/snippet}

<DynamicActionBar
    {leftActions}
    {rightActions}
    paddingLeft={8}
    paddingRight={4}
    separatorWidth={plotSeparatorWidth}
    borderTop={true}
    borderBottom={true}
/>

<style>
    :global(.action-bar-button.plot-action-icon-button) {
        width: 18px;
        height: 22px;
        border-radius: 3px;
    }

    :global(.action-bar-button.plot-action-icon-button .codicon) {
        font-size: 14px;
        padding: 0 1px;
    }

    :global(.action-bar-menu-button.plot-compact-menu-button) {
        gap: 0;
        padding: 0 2px;
    }

    :global(.action-bar-menu-button.plot-compact-menu-button .menu-label) {
        letter-spacing: -0.1px;
    }

    :global(.action-bar-menu-button.plot-compact-menu-button .menu-chevron) {
        font-size: 9px;
    }
</style>
