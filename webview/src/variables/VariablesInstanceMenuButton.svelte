<!--
  VariablesInstanceMenuButton.svelte
  1:1 Positron replication - Menu button for selecting variables instance
-->
<script lang="ts">
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import type { VariablesInstance } from "../types/variables";

    // Props using Svelte 5 runes
    interface Props {
        instances?: VariablesInstance[];
        activeInstanceId?: string;
        onselectInstance?: (id: string) => void;
    }

    let {
        instances = [],
        activeInstanceId,
        onselectInstance,
    }: Props = $props();

    const tooltip = "Select session to view variables from";

    let activeInstance = $derived(
        instances.find((i) => i.id === activeInstanceId),
    );
    let displayName = $derived(
        activeInstance ? activeInstance.sessionName : "None",
    );

    const actions = $derived.by(() =>
        instances.map((instance) => ({
            id: instance.id,
            label: instance.sessionName,
            checked: instance.id === activeInstanceId,
            onSelected: () => onselectInstance?.(instance.id),
        })),
    );
</script>

<ActionBarMenuButton
    label={displayName}
    {tooltip}
    ariaLabel={tooltip}
    disabled={instances.length === 0}
    actions={() => actions}
/>
