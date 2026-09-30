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
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import { zoomActions, sizingActions, darkFilterActions, darkFilterIcon, plotCodeActions, toContextMenuEntries, type PlotMenuAction } from "./plotMenuActions";
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
    const openPlotInNewWindow = localize('plots.openPlotWindow', 'Open plot in new window');
    const openPlotsGalleryInNewWindow = localize('plots.openGalleryWindow', 'Open plots gallery in new window');
    const openInLabel = localize('plots.openIn', 'Open in...');
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
    const enableEditorPlot = $derived(enableImagePlotActions);
    const enableDarkFilter = $derived(enableCopyPlot);
    const enablePopoutPlot = $derived(hasPlots && selectedPlotKind === "html");
    const enableCodeActions = $derived(hasPlots && !!selectedPlotCode);
    const zoomLevelLabels = new Map<ZoomLevel, string>([
        [ZoomLevel.Fit, localize('plots.zoomFit', 'Fit')],
        [ZoomLevel.Fifty, "50%"],
        [ZoomLevel.SeventyFive, "75%"],
        [ZoomLevel.OneHundred, "100%"],
        [ZoomLevel.TwoHundred, "200%"],
    ]);

    const selectedSizingPolicySafe = $derived(
        selectedSizingPolicy ?? {
            id: "auto",
            getName: () => localize('plots.sizing.auto', 'Auto'),
            getPlotSize: () => undefined,
        },
    );
    const activeZoomLabel = $derived(
        zoomLevelLabels.get(zoomLevel) ?? localize('plots.zoomFit', 'Fit'),
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

    // Remember the most recently selected destination, including the gallery.
    let openTarget = $state<EditorTarget | "gallery">("activeGroup");
    $effect(() => { openTarget = openInEditorDefaultTarget; });

    const zoomMenu = $derived(zoomActions(zoomLevel, onZoomChange));
    const sizingMenu = $derived(sizingActions(sizingPolicies, selectedSizingPolicySafe.id, hasIntrinsicSize, !!customSize, onSelectSizingPolicy, handleCustomSize));
    const filterMenu = $derived(darkFilterActions(darkFilterMode, onDarkFilterChange, onOpenDarkFilterSettings));
    const codeMenu = $derived(plotCodeActions({
        plotCode: selectedPlotCode, executionId: selectedPlotExecutionId,
        sessionId: selectedPlotSessionId, languageId: selectedPlotLanguageId,
        hasOriginFile: selectedPlotHasOriginFile, oncopyCode: handleCopyPlotCode,
        onrevealInConsole: handleRevealPlotCodeInConsole, onrunCodeAgain: handleRunPlotCodeAgain,
        onopenSourceFile: handleOpenSourceFile,
    }));
    const openMenu = $derived.by((): PlotMenuAction[] => {
        const items: PlotMenuAction[] = [];
        if (enableEditorPlot) {
            const targets: Array<{ target: EditorTarget; label: string }> = [
                { target: "newWindow", label: localize('plots.openNewWindow', 'Open in new window') },
                { target: "activeGroup", label: localize('plots.openEditorTab', 'Open in editor tab') },
                { target: "sideGroup", label: localize('plots.openInEditorSide', 'Open in editor tab to the Side') },
            ];
            for (const { target, label } of targets) items.push({
                id: target, label, checked: openTarget === target,
                onSelected: () => { openTarget = target; handleOpenInEditor(target); },
            });
        } else if (enablePopoutPlot) {
            items.push({ id: "newWindow", label: openPlotInNewWindow, checked: openTarget !== "gallery",
                onSelected: () => { openTarget = "newWindow"; handlePopoutPlot(); } });
        }
        if (items.length) items.push({ id: "separator", label: "", separator: true });
        items.push({ id: "gallery", label: openPlotsGalleryInNewWindow,
            checked: openTarget === "gallery" || (!enableEditorPlot && !enablePopoutPlot),
            onSelected: () => { openTarget = "gallery"; handleOpenGalleryInNewWindow(); } });
        return items;
    });

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
                    overflowSubmenu: { label: localize('plots.zoom', 'Zoom'), icon: "positron-size-to-fit", entries: toContextMenuEntries(zoomMenu) },
                });
            }
            if (enableSizingPolicy && sizingPolicies.length > 0) {
                actions.push({
                    fixedWidth: 32,
                    text: activeSizingPolicyLabel,
                    minWidth: 56,
                    separator: false,
                    component: sizingSnippet,
                    overflowSubmenu: { label: localize('plots.sizingMenu', 'Sizing'), icon: "symbol-ruler", entries: toContextMenuEntries(sizingMenu) },
                });
            }
            if (enableDarkFilter) {
                actions.push({
                    fixedWidth: 36, separator: false, component: darkFilterSnippet,
                    overflowSubmenu: { label: localize('plots.darkFilter', 'Dark Filter'), icon: darkFilterIcon(darkFilterMode), entries: toContextMenuEntries(filterMenu) },
                });
            }
            if (enableCodeActions) {
                actions.push({
                    fixedWidth: 36,
                    separator: false,
                    component: codeMenuSnippet,
                    overflowSubmenu: { label: localize('plots.codeMenu', 'Code'), icon: "code", entries: toContextMenuEntries(codeMenu) },
                });
            }
        }

        return actions;
    });

    const rightActions: DynamicAction[] = $derived.by(() => {
        const actions: DynamicAction[] = [];

        actions.push({
            fixedWidth: 36, separator: true, component: openInEditorSnippet,
            overflowSubmenu: { label: openInLabel, icon: "positron-open-in-new-window", entries: toContextMenuEntries(openMenu) },
        });

        actions.push({
            fixedWidth: plotIconButtonWidth,
            separator: false,
            component: clearAllSnippet,
            overflowMenuItem: {
                label: clearAllPlots,
                icon: "trash",
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
    <ActionBarMenuButton icon="positron-size-to-fit" buttonClass="plot-compact-menu-button"
        label={activeZoomLabel} tooltip={localize('plots.zoomTooltip', 'Set the plot zoom')}
        ariaLabel={localize('plots.zoomTooltip', 'Set the plot zoom')}
        actions={() => zoomMenu} />
{/snippet}

{#snippet sizingSnippet()}
    <ActionBarMenuButton icon="symbol-ruler" buttonClass="plot-compact-menu-button"
        label={activeSizingPolicyLabel} tooltip={localize('plots.sizingPolicy', "Set how the plot's shape and size are determined")}
        ariaLabel={localize('plots.sizingPolicy', "Set how the plot's shape and size are determined")}
        actions={() => sizingMenu} />
{/snippet}

{#snippet openInEditorSnippet()}
    <ActionBarMenuButton icon="positron-open-in-new-window" align="right"
        tooltip={openInLabel} ariaLabel={openInLabel} actions={() => openMenu} />
{/snippet}

{#snippet codeMenuSnippet()}
    <ActionBarMenuButton icon="code" tooltip={selectedPlotCode || localize('plots.codeActions', 'Plot code actions')}
        ariaLabel={localize('plots.codeActions', 'Plot code actions')} actions={() => codeMenu} />
{/snippet}

{#snippet darkFilterSnippet()}
    <ActionBarMenuButton icon={darkFilterIcon(darkFilterMode)}
        tooltip={localize('plots.filterTooltip', 'Set whether a dark filter is applied to plots.')}
        ariaLabel={localize('plots.filterTooltip', 'Set whether a dark filter is applied to plots.')}
        actions={() => filterMenu} />
{/snippet}

{#snippet clearAllSnippet()}
    <ActionBarButton
        icon="trash"
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
    :global(.positron-plots-container .codicon-color-mode) {
        rotate: 0deg;
        transition: 0.2s ease;
    }

    :global(.vscode-dark .positron-plots-container .codicon-color-mode) {
        rotate: 180deg;
    }

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
