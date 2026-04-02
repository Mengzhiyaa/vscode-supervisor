<!--
  AddEditRowFilterModal.svelte - Anchored popup for adding/editing row filters (Svelte 5 runes mode)
  Port from Positron's addEditRowFilterModalPopup.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import {
        RowFilterDescrType,
        RowFilterCondition,
        RowFilterDescriptorIsEmpty,
        RowFilterDescriptorIsNotEmpty,
        RowFilterDescriptorIsNull,
        RowFilterDescriptorIsNotNull,
        RowFilterDescriptorIsTrue,
        RowFilterDescriptorIsFalse,
        RowFilterDescriptorComparison,
        RowFilterDescriptorSearch,
        RowFilterDescriptorIsBetween,
        RowFilterDescriptorIsNotBetween,
        filterTypeRequiresValue,
        filterTypeRequiresRange,
        type RowFilterDescriptor,
    } from "./rowFilterDescriptor";
    import type { SchemaColumn } from "../../../../../dataGrid/types";
    import ModalPopup from "../../../../../shared/ModalPopup.svelte";
    import DropDownColumnSelector from "./components/dropDownColumnSelector.svelte";
    import DropDownListBox, {
        type DropDownListBoxEntry,
    } from "../../../../../shared/DropDownListBox.svelte";
    import RowFilterParameter from "./components/rowFilterParameter.svelte";
    import {
        getEffectiveColumnDisplayType,
        isBooleanDisplayType,
        isDateDisplayType,
        isDatetimeDisplayType,
        isNumericDisplayType,
        isStringDisplayType,
        isTimeDisplayType,
    } from "../../../../columnDisplayTypeUtils";
    import { localize } from "../../../../nls";

    interface FocusableComponent {
        focus: () => void;
    }

    interface Props {
        anchorElement: HTMLElement;
        columns: SchemaColumn[];
        selectedColumn?: SchemaColumn;
        editFilter?: RowFilterDescriptor;
        onApply: (filter: RowFilterDescriptor) => void;
        onCancel: (options?: { restoreFocus?: boolean }) => void;
    }

    let {
        anchorElement,
        columns,
        selectedColumn,
        editFilter,
        onApply,
        onCancel,
    }: Props = $props();

    function resolveInitialColumn(): SchemaColumn | undefined {
        return (
            selectedColumn ??
            (editFilter
                ? columns.find(
                      (column) =>
                          column.column_index === editFilter.schema.column_index,
                  ) ?? editFilter.schema
                : undefined)
        );
    }

    function getInitialFirstValue(): string {
        if (!editFilter) {
            return "";
        }

        if ("value" in editFilter) {
            return (editFilter as { value: string }).value;
        }

        if ("lowerLimit" in editFilter) {
            return (editFilter as { lowerLimit: string }).lowerLimit;
        }

        return "";
    }

    function getInitialSecondValue(): string {
        if (!editFilter) {
            return "";
        }

        if ("upperLimit" in editFilter) {
            return (editFilter as { upperLimit: string }).upperLimit;
        }

        return "";
    }

    function getInitialSelectedColumnSchema(): SchemaColumn | undefined {
        return resolveInitialColumn();
    }

    function getInitialSelectedFilterType():
        | RowFilterDescrType
        | undefined {
        return editFilter?.descrType;
    }

    function getInitialErrorText(): string | undefined {
        return editFilter?.props.errorMessage;
    }

    let selectedColumnSchema = $state<SchemaColumn | undefined>(
        getInitialSelectedColumnSchema(),
    );
    let selectedFilterType = $state<RowFilterDescrType | undefined>(
        getInitialSelectedFilterType(),
    );
    let firstValue = $state(getInitialFirstValue());
    let secondValue = $state(getInitialSecondValue());
    let errorText = $state<string | undefined>(getInitialErrorText());

    let dropDownColumnSelectorRef =
        $state<FocusableComponent | null>(null);
    let dropDownConditionRef = $state<FocusableComponent | null>(null);
    let firstParameterRef = $state<FocusableComponent | null>(null);
    let secondParameterRef = $state<FocusableComponent | null>(null);
    let previousSelectedColumnSchema = getInitialSelectedColumnSchema();
    let previousSelectedFilterType = getInitialSelectedFilterType();

    const focusColumnSelector = () => {
        queueMicrotask(() => {
            dropDownColumnSelectorRef?.focus();
        });
    };

    const focusConditionSelector = () => {
        queueMicrotask(() => {
            dropDownConditionRef?.focus();
        });
    };

    const focusFirstParameter = () => {
        queueMicrotask(() => {
            firstParameterRef?.focus();
        });
    };

    const focusSecondParameter = () => {
        queueMicrotask(() => {
            secondParameterRef?.focus();
        });
    };

    $effect(() => {
        if (
            selectedColumnSchema &&
            previousSelectedColumnSchema !== selectedColumnSchema
        ) {
            focusConditionSelector();
        }

        previousSelectedColumnSchema = selectedColumnSchema;
    });

    $effect(() => {
        if (
            selectedFilterType &&
            previousSelectedFilterType !== selectedFilterType
        ) {
            focusFirstParameter();
        }

        previousSelectedFilterType = selectedFilterType;
    });

    onMount(() => {
        if (!resolveInitialColumn()) {
            focusColumnSelector();
            return;
        }

        focusConditionSelector();
    });

    function filterNumParams(filterType: RowFilterDescrType | undefined): number {
        if (!filterType) {
            return 0;
        }

        if (filterTypeRequiresRange(filterType)) {
            return 2;
        }

        if (filterTypeRequiresValue(filterType)) {
            return 1;
        }

        return 0;
    }

    function isSingleParam(filterType: RowFilterDescrType | undefined): boolean {
        return filterNumParams(filterType) === 1;
    }

    function isTwoParams(filterType: RowFilterDescrType | undefined): boolean {
        return filterNumParams(filterType) === 2;
    }

    function clearFilterValuesAndErrorText() {
        firstValue = "";
        secondValue = "";
        errorText = undefined;
    }

    function displayType(columnSchema: SchemaColumn): string {
        return getEffectiveColumnDisplayType(
            columnSchema.type_display,
            columnSchema.type_name,
        );
    }

    function isStringType(columnSchema: SchemaColumn): boolean {
        return isStringDisplayType(displayType(columnSchema));
    }

    function isBooleanType(columnSchema: SchemaColumn): boolean {
        return isBooleanDisplayType(displayType(columnSchema));
    }

    function isDateLikeType(columnSchema: SchemaColumn): boolean {
        const type = displayType(columnSchema);
        return (
            isDateDisplayType(type) ||
            isDatetimeDisplayType(type) ||
            isTimeDisplayType(type)
        );
    }

    function isNumericType(columnSchema: SchemaColumn): boolean {
        return isNumericDisplayType(displayType(columnSchema));
    }

    const conditionEntries = $derived.by((): DropDownListBoxEntry[] => {
        if (!selectedColumnSchema) {
            return [];
        }

        const entries: DropDownListBoxEntry[] = [];

        entries.push({
            identifier: RowFilterDescrType.IS_NULL,
            title: localize(
                "positron.addEditRowFilter.conditionIsNull",
                "is missing",
            ),
        });

        entries.push({
            identifier: RowFilterDescrType.IS_NOT_NULL,
            title: localize(
                "positron.addEditRowFilter.conditionIsNotNull",
                "is not missing",
            ),
        });

        entries.push({
            identifier: RowFilterDescrType.IS_NULL,
            title: "",
            isSeparator: true,
        });

        if (isStringType(selectedColumnSchema)) {
            entries.push({
                identifier: RowFilterDescrType.SEARCH_CONTAINS,
                title: localize(
                    "positron.addEditRowFilter.conditionSearchContains",
                    "contains",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.SEARCH_NOT_CONTAINS,
                title: localize(
                    "positron.addEditRowFilter.conditionSearchNotContains",
                    "does not contain",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.SEARCH_STARTS_WITH,
                title: localize(
                    "positron.addEditRowFilter.conditionSearchStartsWith",
                    "starts with",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.SEARCH_ENDS_WITH,
                title: localize(
                    "positron.addEditRowFilter.conditionSearchEndsWith",
                    "ends with",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.SEARCH_REGEX_MATCHES,
                title: localize(
                    "positron.addEditRowFilter.conditionSearchRegexMatches",
                    "regex matches",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_EMPTY,
                title: localize(
                    "positron.addEditRowFilter.conditionIsEmpty",
                    "is empty",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_NOT_EMPTY,
                title: localize(
                    "positron.addEditRowFilter.conditionIsNotEmpty",
                    "is not empty",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_EMPTY,
                title: "",
                isSeparator: true,
            });
        }

        if (isNumericType(selectedColumnSchema) || isDateLikeType(selectedColumnSchema)) {
            entries.push({
                identifier: RowFilterDescrType.IS_LESS_THAN,
                title: localize(
                    "positron.addEditRowFilter.conditionIsLessThan",
                    "is less than",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_LESS_OR_EQUAL,
                title: localize(
                    "positron.addEditRowFilter.conditionIsLessThanOrEqual",
                    "is less than or equal to",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_GREATER_THAN,
                title: localize(
                    "positron.addEditRowFilter.conditionIsGreaterThan",
                    "is greater than",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_GREATER_OR_EQUAL,
                title: localize(
                    "positron.addEditRowFilter.conditionIsGreaterThanOrEqual",
                    "is greater than or equal to",
                ),
            });
        }

        if (
            !isBooleanType(selectedColumnSchema) &&
            (isNumericType(selectedColumnSchema) ||
                isStringType(selectedColumnSchema) ||
                isDateLikeType(selectedColumnSchema))
        ) {
            entries.push({
                identifier: RowFilterDescrType.IS_EQUAL_TO,
                title: localize(
                    "positron.addEditRowFilter.conditionIsEqualTo",
                    "is equal to",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_NOT_EQUAL_TO,
                title: localize(
                    "positron.addEditRowFilter.conditionIsNotEqualTo",
                    "is not equal to",
                ),
            });
        }

        if (isBooleanType(selectedColumnSchema)) {
            entries.push({
                identifier: RowFilterDescrType.IS_TRUE,
                title: localize(
                    "positron.addEditRowFilter.conditionIsTrue",
                    "is true",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_FALSE,
                title: localize(
                    "positron.addEditRowFilter.conditionIsFalse",
                    "is false",
                ),
            });
        }

        if (isNumericType(selectedColumnSchema) || isDateLikeType(selectedColumnSchema)) {
            entries.push({
                identifier: RowFilterDescrType.IS_BETWEEN,
                title: "",
                isSeparator: true,
            });

            entries.push({
                identifier: RowFilterDescrType.IS_BETWEEN,
                title: localize(
                    "positron.addEditRowFilter.conditionIsBetween",
                    "is between",
                ),
            });

            entries.push({
                identifier: RowFilterDescrType.IS_NOT_BETWEEN,
                title: localize(
                    "positron.addEditRowFilter.conditionIsNotBetween",
                    "is not between",
                ),
            });
        }

        return entries;
    });

    const numParams = $derived(filterNumParams(selectedFilterType));

    const firstPlaceholder = $derived(
        numParams === 2
            ? localize(
                  "positron.addEditRowFilter.lowerLimitPlaceholder",
                  "lower limit",
              )
            : localize("positron.addEditRowFilter.valuePlaceholder", "value"),
    );

    const secondPlaceholder = localize(
        "positron.addEditRowFilter.upperLimitPlaceholder",
        "upper limit",
    );

    function validateRowFilterValue(columnSchema: SchemaColumn, value: string): boolean {
        if (isNumericType(columnSchema)) {
            return /^[-]?\d*\.?\d*$/.test(value);
        }

        if (isBooleanType(columnSchema)) {
            return /^(true|false)$/i.test(value);
        }

        if (isDateLikeType(columnSchema)) {
            return !Number.isNaN(Date.parse(value));
        }

        return true;
    }

    function applyRowFilter() {
        if (!selectedColumnSchema) {
            errorText = localize(
                "positron.addEditRowFilter.pleaseSelectColumn",
                "Please select the column.",
            );
            return;
        }

        if (!selectedFilterType) {
            errorText = localize(
                "positron.addEditRowFilter.pleaseSelectCondition",
                "Please select the condition.",
            );
            return;
        }

        const columnSchema = selectedColumnSchema;
        const filterType = selectedFilterType;

        const validateFirstRowFilterValue = () => {
            const value = firstValue.trim();

            if (value.length === 0) {
                switch (filterType) {
                    case RowFilterDescrType.IS_BETWEEN:
                    case RowFilterDescrType.IS_NOT_BETWEEN:
                        errorText = localize(
                            "positron.addEditRowFilter.pleaseSupplyLowerLimit",
                            "Please supply the lower limit.",
                        );
                        break;
                    default:
                        errorText = localize(
                            "positron.addEditRowFilter.pleaseSupplyValue",
                            "Please supply the value.",
                        );
                        break;
                }

                focusFirstParameter();
                return false;
            }

            if (!validateRowFilterValue(columnSchema, value)) {
                switch (filterType) {
                    case RowFilterDescrType.IS_BETWEEN:
                    case RowFilterDescrType.IS_NOT_BETWEEN:
                        errorText = localize(
                            "positron.addEditRowFilter.pleaseSupplyValidLowerLimit",
                            "Please supply a valid lower limit.",
                        );
                        break;
                    default:
                        errorText = localize(
                            "positron.addEditRowFilter.pleaseSupplyValidValue",
                            "Please supply a valid value.",
                        );
                        break;
                }

                focusFirstParameter();
                return false;
            }

            return true;
        };

        const validateSecondRowFilterValue = () => {
            const value = secondValue.trim();

            if (value.length === 0) {
                errorText = localize(
                    "positron.addEditRowFilter.pleaseSupplyUpperLimit",
                    "Please supply the upper limit.",
                );
                focusSecondParameter();
                return false;
            }

            if (!validateRowFilterValue(columnSchema, value)) {
                errorText = localize(
                    "positron.addEditRowFilter.pleaseSupplyValidUpperLimit",
                    "Please supply a valid upper limit.",
                );
                focusSecondParameter();
                return false;
            }

            return true;
        };

        const commonProps = {
            columnSchema: columnSchema,
            condition: RowFilterCondition.And,
        };

        const applyDescriptor = (rowFilter: RowFilterDescriptor) => {
            errorText = undefined;
            onApply(rowFilter);
        };

        switch (filterType) {
            case RowFilterDescrType.IS_EMPTY:
                applyDescriptor(new RowFilterDescriptorIsEmpty(commonProps));
                break;

            case RowFilterDescrType.IS_NOT_EMPTY:
                applyDescriptor(new RowFilterDescriptorIsNotEmpty(commonProps));
                break;

            case RowFilterDescrType.IS_NULL:
                applyDescriptor(new RowFilterDescriptorIsNull(commonProps));
                break;

            case RowFilterDescrType.IS_NOT_NULL:
                applyDescriptor(new RowFilterDescriptorIsNotNull(commonProps));
                break;

            case RowFilterDescrType.IS_TRUE:
                applyDescriptor(new RowFilterDescriptorIsTrue(commonProps));
                break;

            case RowFilterDescrType.IS_FALSE:
                applyDescriptor(new RowFilterDescriptorIsFalse(commonProps));
                break;

            case RowFilterDescrType.SEARCH_CONTAINS:
            case RowFilterDescrType.SEARCH_NOT_CONTAINS:
            case RowFilterDescrType.SEARCH_STARTS_WITH:
            case RowFilterDescrType.SEARCH_ENDS_WITH:
            case RowFilterDescrType.SEARCH_REGEX_MATCHES:
                if (!validateFirstRowFilterValue()) {
                    return;
                }

                applyDescriptor(
                    new RowFilterDescriptorSearch(
                        commonProps,
                        firstValue,
                        filterType,
                    ),
                );
                break;

            case RowFilterDescrType.IS_LESS_THAN:
            case RowFilterDescrType.IS_LESS_OR_EQUAL:
            case RowFilterDescrType.IS_GREATER_THAN:
            case RowFilterDescrType.IS_GREATER_OR_EQUAL:
            case RowFilterDescrType.IS_EQUAL_TO:
            case RowFilterDescrType.IS_NOT_EQUAL_TO:
                if (!validateFirstRowFilterValue()) {
                    return;
                }

                applyDescriptor(
                    new RowFilterDescriptorComparison(
                        commonProps,
                        firstValue,
                        filterType,
                    ),
                );
                break;

            case RowFilterDescrType.IS_BETWEEN:
                if (!validateFirstRowFilterValue()) {
                    return;
                }

                if (!validateSecondRowFilterValue()) {
                    return;
                }

                applyDescriptor(
                    new RowFilterDescriptorIsBetween(
                        commonProps,
                        firstValue,
                        secondValue,
                    ),
                );
                break;

            case RowFilterDescrType.IS_NOT_BETWEEN:
                if (!validateFirstRowFilterValue()) {
                    return;
                }

                if (!validateSecondRowFilterValue()) {
                    return;
                }

                applyDescriptor(
                    new RowFilterDescriptorIsNotBetween(
                        commonProps,
                        firstValue,
                        secondValue,
                    ),
                );
                break;
        }
    }

    function handleColumnSchemaChanged(columnSchema: SchemaColumn) {
        selectedColumnSchema = columnSchema;
        selectedFilterType = undefined;
        clearFilterValuesAndErrorText();
    }

    function handleConditionChanged(entry: DropDownListBoxEntry) {
        const previousType = selectedFilterType;
        const nextType = entry.identifier as RowFilterDescrType;

        selectedFilterType = nextType;

        if (filterNumParams(previousType) !== filterNumParams(nextType)) {
            if (
                (isSingleParam(previousType) && isTwoParams(nextType)) ||
                (isTwoParams(previousType) && isSingleParam(nextType))
            ) {
                secondValue = "";
                errorText = undefined;
            } else {
                clearFilterValuesAndErrorText();
            }
        }
    }

    function handleParameterKeyDown(event: KeyboardEvent) {
        if (event.key !== "Enter") {
            return;
        }

        event.preventDefault();
        applyRowFilter();
    }
</script>

<ModalPopup
    {anchorElement}
    width={275}
    fixedHeight={true}
    keyboardNavigationStyle="menu"
    popupAlignment="auto"
    popupPosition="auto"
    onClose={() => onCancel({ restoreFocus: false })}
>
    <div class="add-edit-row-filter-modal-popup-body">
        <DropDownColumnSelector
            bind:this={dropDownColumnSelectorRef}
            {columns}
            {selectedColumnSchema}
            title={localize(
                "positron.addEditRowFilter.selectColumn",
                "Select Column",
            )}
            onSelectedColumnSchemaChanged={handleColumnSchemaChanged}
        />

        <DropDownListBox
            bind:this={dropDownConditionRef}
            disabled={selectedColumnSchema === undefined}
            entries={conditionEntries}
            selectedIdentifier={selectedFilterType}
            title={localize(
                "positron.addEditRowFilter.selectCondition",
                "Select Condition",
            )}
            onSelectionChanged={handleConditionChanged}
        />

        {#if numParams >= 1}
            <RowFilterParameter
                bind:this={firstParameterRef}
                placeholder={firstPlaceholder}
                value={firstValue}
                onTextChanged={(text) => {
                    firstValue = text;
                    errorText = undefined;
                }}
                onKeyDown={handleParameterKeyDown}
            />
        {/if}

        {#if numParams === 2}
            <RowFilterParameter
                bind:this={secondParameterRef}
                placeholder={secondPlaceholder}
                value={secondValue}
                onTextChanged={(text) => {
                    secondValue = text;
                    errorText = undefined;
                }}
                onKeyDown={handleParameterKeyDown}
            />
        {/if}

        {#if errorText}
            <div class="error">{errorText}</div>
        {/if}

        <button
            class="button-apply-row-filter"
            onclick={applyRowFilter}
            type="button"
        >
            {localize("positron.addEditRowFilter.applyFilter", "Apply Filter")}
        </button>
    </div>
</ModalPopup>

<style>
    .add-edit-row-filter-modal-popup-body {
        gap: 8px;
        padding: 10px;
        display: flex;
        font-size: 12px;
        line-height: 16px;
        flex-direction: column;
    }

    .add-edit-row-filter-modal-popup-body .error {
        color: var(--vscode-positronError-foreground, var(--vscode-errorForeground));
    }

    .add-edit-row-filter-modal-popup-body .button-apply-row-filter {
        height: 26px;
        padding: 4px;
        display: flex;
        cursor: pointer;
        margin: 0;
        border: none;
        border-radius: 4px;
        align-items: center;
        font: inherit;
        font-weight: 600;
        line-height: 16px;
        appearance: none;
        -webkit-appearance: none;
        justify-content: center;
        color: var(
            --vscode-positronModalDialog-defaultButtonForeground,
            var(--vscode-button-foreground)
        );
        background-color: var(
            --vscode-positronModalDialog-defaultButtonBackground,
            var(--vscode-button-background)
        );
    }

    .add-edit-row-filter-modal-popup-body .button-apply-row-filter:hover {
        background-color: var(
            --vscode-positronModalDialog-defaultButtonHoverBackground,
            var(--vscode-button-hoverBackground)
        );
    }

    .add-edit-row-filter-modal-popup-body
        .button-apply-row-filter:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
