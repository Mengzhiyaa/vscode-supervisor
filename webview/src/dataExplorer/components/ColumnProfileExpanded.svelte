<!--
  ColumnProfileExpanded.svelte - Compatibility wrapper for expanded column profiles
-->
<script lang="ts">
    import { getDataExplorerContext } from "../positronDataExplorerContext";
    import {
        getEffectiveColumnDisplayType,
        isBooleanDisplayType,
        isDateDisplayType,
        isDatetimeDisplayType,
        isIntegerDisplayType,
        isNumericDisplayType,
        isObjectDisplayType,
        isStringDisplayType,
    } from "../columnDisplayTypeUtils";
    import type { ColumnProfileViewResult } from "../columnProfileTypes";
    import ColumnProfileBoolean from "./columnProfileBoolean.svelte";
    import ColumnProfileDate from "./columnProfileDate.svelte";
    import ColumnProfileDatetime from "./columnProfileDatetime.svelte";
    import ColumnProfileInteger from "./columnProfileInteger.svelte";
    import ColumnProfileNumber from "./columnProfileNumber.svelte";
    import ColumnProfileObject from "./columnProfileObject.svelte";
    import ColumnProfileString from "./columnProfileString.svelte";

    interface Props {
        columnIndex: number;
        columnType: string;
        typeDisplay: string;
        resolvedTypeDisplay?: string;
        profile?: ColumnProfileViewResult;
    }

    let {
        columnIndex,
        columnType,
        typeDisplay,
        resolvedTypeDisplay,
        profile,
    }: Props = $props();

    const { tableSchemaDataGridInstance } = getDataExplorerContext();

    const effectiveType = $derived(
        getEffectiveColumnDisplayType(typeDisplay, columnType),
    );
    const profileDisplayType = $derived.by(() =>
        getEffectiveColumnDisplayType(
            resolvedTypeDisplay ?? profile?.summary_stats?.type_display,
            effectiveType,
        ),
    );
    const isInteger = $derived(isIntegerDisplayType(profileDisplayType));
    const isNumeric = $derived(isNumericDisplayType(profileDisplayType));
    const isBoolean = $derived(isBooleanDisplayType(profileDisplayType));
    const isString = $derived(isStringDisplayType(profileDisplayType));
    const isDateOnly = $derived(isDateDisplayType(profileDisplayType));
    const isDateTime = $derived(isDatetimeDisplayType(profileDisplayType));
    const isObject = $derived(isObjectDisplayType(profileDisplayType));
</script>

{#if isNumeric}
    {#if isInteger}
        <ColumnProfileInteger instance={tableSchemaDataGridInstance} {columnIndex} />
    {:else}
        <ColumnProfileNumber instance={tableSchemaDataGridInstance} {columnIndex} />
    {/if}
{:else if isBoolean}
    <ColumnProfileBoolean instance={tableSchemaDataGridInstance} {columnIndex} />
{:else if isString}
    <ColumnProfileString instance={tableSchemaDataGridInstance} {columnIndex} />
{:else if isDateOnly}
    <ColumnProfileDate instance={tableSchemaDataGridInstance} {columnIndex} />
{:else if isDateTime}
    <ColumnProfileDatetime instance={tableSchemaDataGridInstance} {columnIndex} />
{:else if isObject}
    <ColumnProfileObject instance={tableSchemaDataGridInstance} {columnIndex} />
{/if}
