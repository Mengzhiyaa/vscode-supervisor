<!--
  ActionBar.svelte
  Plots panel action bar — uses DynamicActionBar for overflow support.
  Mirrors: positron/positronPlots/browser/components/actionBars.tsx
-->
<script lang="ts">
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
    import { localize } from "../lib/localization";

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
        onPrevious?: () => void;
        onNext?: () => void;
        onSave?: () => void;
        onCopy?: () => void;
        onZoomChange?: (zoomLevel: ZoomLevel) => void;
        onDarkFilterChange?: (mode: DarkFilter) => void;
        onSelectSizingPolicy?: (policyId: string) => void;
        onSetCustomSize?: () => void;
        onClearAll?: () => void;
        onOpenInEditor?: (target: OpenInEditorTarget) => void;
        onPopoutPlot?: () => void;
        onRevealPlotCodeInConsole?: (data: {
            sessionId: string;
            executionId: string;
        }) => void;
        onRunPlotCodeAgain?: (data: {
            code: string;
            sessionId: string;
            languageId: string;
        }) => void;
        onOpenSourceFile?: () => void;
        onOpenGalleryInNewWindow?: () => void;
        onOpenDarkFilterSettings?: () => void;
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
        onPrevious,
        onNext,
        onSave,
        onCopy,
        onZoomChange,
        onDarkFilterChange,
        onSelectSizingPolicy,
        onSetCustomSize,
        onClearAll,
        onOpenInEditor,
        onPopoutPlot,
        onRevealPlotCodeInConsole,
        onRunPlotCodeAgain,
        onOpenSourceFile,
        onOpenGalleryInNewWindow,
        onOpenDarkFilterSettings,
    }: Props = $props();

    const showPreviousPlot = localize('plots.previous', 'Show previous plot');
    const showNextPlot = localize('plots.next', 'Show next plot');
    const savePlot = localize('plots.save', 'Save plot');
    const copyPlotToClipboard = localize('plots.copyPlot', 'Copy plot to clipboard');
    const openPlotInNewWindow = "Open plot in new window";
    const openPlotsGalleryInNewWindow = "Open plots gallery in new window";
    const clearAllPlots = localize('plots.clearAll', 'Clear all plots');
    const plotIconButtonWidth = 18;
    const plotSeparatorWidth = 5;

    const isDynamicPlot = $derived(selectedPlotKind === "dynamic");
    const isStaticPlot = $derived(selectedPlotKind === "static");
    const enableSizingPolicy = $derived(hasPlots && isDynamicPlot);
    const enableImagePlotActions = $derived(
        hasPlots && (isDynamicPlot || isStaticPlot),
    );
    const enableSavingPlots = $derived(enableImagePlotActions);
    const enableCopyPlot = $derived(enableImagePlotActions);
    const enableZoomPlot = $derived(enableImagePlotActions);
    const enableEditorPlot = $derived(hasPlots);
    const enableDarkFilter = $derived(enableCopyPlot);
    const enablePopoutPlot = $derived(false);
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

    function handlePrevious() { onPrevious?.(); }
    function handleNext() { onNext?.(); }
    function handleSave() { onSave?.(); }
    function handleCopy() { onCopy?.(); }
    function handleCustomSize() { onSetCustomSize?.(); }
    function handleClearAll() { onClearAll?.(); }

    function mapEditorTarget(target: EditorTarget): OpenInEditorTarget {
        switch (target) {
            case "sideGroup": return "editorTabSide";
            case "newWindow": return "newWindow";
            case "activeGroup":
            default: return "editorTab";
        }
    }

    function handleOpenInEditor(target: EditorTarget) {
        onOpenInEditor?.(mapEditorTarget(target));
    }

    function handlePopoutPlot() { onPopoutPlot?.(); }

    function handleCopyPlotCode(code: string) {
        if (!code) return;
        void navigator.clipboard.writeText(code).catch((error) => {
            console.warn("Failed to copy plot code:", error);
        });
    }

    function handleRevealPlotCodeInConsole(data: { sessionId: string; executionId: string }) {
        onRevealPlotCodeInConsole?.(data);
    }

    function handleRunPlotCodeAgain(data: { code: string; sessionId: string; languageId: string }) {
        onRunPlotCodeAgain?.(data);
    }

    function handleOpenSourceFile() {
        onOpenSourceFile?.();
    }

    function handleOpenGalleryInNewWindow() { onOpenGalleryInNewWindow?.(); }

    function getOpenInEditorTooltip(target: EditorTarget): string {
        switch (target) {
            case "sideGroup": return localize('plots.openInEditorSide', 'Open in editor tab to the Side');
            case "newWindow": return localize('plots.openNewWindow', 'Open in new window');
            case "activeGroup":
            default: return localize('plots.openEditorTab', 'Open in editor tab');
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
    <ZoomPlotMenuButton {zoomLevel} {onZoomChange} />
{/snippet}

{#snippet sizingSnippet()}
    <SizingPolicyMenuButton
        selectedPolicy={selectedSizingPolicySafe} policies={sizingPolicies}
        {hasIntrinsicSize} {customSize}
        onSelectPolicy={onSelectSizingPolicy}
        onSetCustomSize={handleCustomSize} />
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
        {onDarkFilterChange}
        onOpenSettings={onOpenDarkFilterSettings}
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
