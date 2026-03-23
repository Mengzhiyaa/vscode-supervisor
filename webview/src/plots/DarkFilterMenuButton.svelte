<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import { DarkFilter } from "./types";

    interface Props {
        darkFilterMode: DarkFilter;
    }

    let { darkFilterMode }: Props = $props();

    const dispatch = createEventDispatcher<{
        darkFilterChange: { mode: DarkFilter };
        openSettings: void;
    }>();

    const darkFilterLabels = new Map<DarkFilter, string>([
        [DarkFilter.On, "Dark Filter"],
        [DarkFilter.Off, "No Filter"],
        [DarkFilter.Auto, "Follow Theme"],
    ]);
    const darkFilterModes: DarkFilter[] = [
        DarkFilter.On,
        DarkFilter.Off,
        DarkFilter.Auto,
    ];
    const darkFilterTooltip =
        "Set whether a dark filter is applied to plots.";
    const openDarkFilterSettings = "Change Default in Settings...";

    function getDarkFilterIcon(mode: DarkFilter): string {
        switch (mode) {
            case DarkFilter.On:
                return "circle-large-filled";
            case DarkFilter.Off:
                return "circle-large";
            case DarkFilter.Auto:
            default:
                return "color-mode";
        }
    }
</script>

<ActionBarMenuButton
    icon={getDarkFilterIcon(darkFilterMode)}
    tooltip={darkFilterTooltip}
    ariaLabel={darkFilterTooltip}
    actions={() => [
        ...darkFilterModes.map((mode) => ({
            id: mode,
            label: darkFilterLabels.get(mode) ?? mode,
            checked: darkFilterMode === mode,
            onSelected: () => {
                dispatch("darkFilterChange", { mode });
            },
        })),
        {
            id: "settings-separator",
            label: "",
            separator: true,
            onSelected: () => {},
        },
        {
            id: "open-settings",
            label: openDarkFilterSettings,
            onSelected: () => {
                dispatch("openSettings");
            },
        },
    ]}
/>

<style>
    :global(.vscode-dark .codicon-color-mode) {
        transform: rotate(180deg);
        transition: 0.2s ease;
    }

    :global(.codicon-color-mode) {
        transform: rotate(0deg);
        transition: 0.2s ease;
    }
</style>
