<script lang="ts">
    /**
     * SizingPolicyMenuButton component.
     * A menu button for selecting the plot sizing policy.
     * Matches Positron's SizingPolicyMenuButton component.
     *
     * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
     * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
     */

    import { createEventDispatcher } from "svelte";
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";

    /**
     * IPositronPlotSizingPolicy interface.
     */
    interface IPositronPlotSizingPolicy {
        id: string;
        getName(plot?: any): string;
        getPlotSize(viewportSize: {
            width: number;
            height: number;
        }): { width: number; height: number } | undefined;
    }

    /**
     * SizingPolicy enum for standard policies.
     */
    export const SizingPolicyId = {
        Auto: "auto",
        Intrinsic: "intrinsic",
        Fill: "fill",
        Custom: "custom",
        Square: "square",
        Landscape: "landscape",
        Portrait: "portrait",
    } as const;

    interface Props {
        /** Currently selected sizing policy */
        selectedPolicy: IPositronPlotSizingPolicy;
        /** Available sizing policies */
        policies: IPositronPlotSizingPolicy[];
        /** Whether intrinsic size is available */
        hasIntrinsicSize?: boolean;
        /** Custom size if set */
        customSize?: { width: number; height: number };
    }

    let {
        selectedPolicy,
        policies,
        hasIntrinsicSize = false,
        customSize,
    }: Props = $props();

    const dispatch = createEventDispatcher<{
        selectPolicy: { policyId: string };
        setCustomSize: void;
        clearCustomSize: void;
    }>();

    // Localized strings matching Positron
    const sizingPolicyTooltip =
        "Set how the plot's shape and size are determined";
    const newCustomPolicyTooltip = "New Custom Size...";
    const changeCustomPolicyTooltip = "Change Custom Size...";

    // Get the active policy label
    const activePolicyLabel = $derived(selectedPolicy.getName());

    // Check if a policy is enabled
    function isPolicyEnabled(policy: IPositronPlotSizingPolicy): boolean {
        // Intrinsic policy is only enabled if the plot has an intrinsic size
        if (policy.id === SizingPolicyId.Intrinsic) {
            return hasIntrinsicSize;
        }
        return true;
    }

    // Check if a policy is the custom policy
    function isCustomPolicy(policy: IPositronPlotSizingPolicy): boolean {
        return policy.id === SizingPolicyId.Custom;
    }
</script>

<ActionBarMenuButton
    icon="symbol-ruler"
    buttonClass="plot-compact-menu-button"
    label={activePolicyLabel}
    tooltip={sizingPolicyTooltip}
    ariaLabel={sizingPolicyTooltip}
    actions={() => [
        ...policies
            .filter((policy) => !isCustomPolicy(policy))
            .map((policy) => ({
                id: policy.id,
                label: policy.getName(),
                checked: policy.id === selectedPolicy.id,
                disabled: !isPolicyEnabled(policy),
                onSelected: () => {
                    dispatch("selectPolicy", { policyId: policy.id });
                },
            })),
        {
            id: "custom-separator",
            label: "",
            separator: true,
        },
        ...policies
            .filter((policy) => isCustomPolicy(policy))
            .map((policy) => ({
                id: policy.id,
                label: policy.getName(),
                checked: policy.id === selectedPolicy.id,
                onSelected: () => {
                    dispatch("selectPolicy", { policyId: policy.id });
                },
            })),
        {
            id: "custom-size",
            label: customSize
                ? changeCustomPolicyTooltip
                : newCustomPolicyTooltip,
            onSelected: () => {
                dispatch("setCustomSize");
            },
        },
    ]}
/>
