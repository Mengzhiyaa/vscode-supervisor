/*---------------------------------------------------------------------------------------------
 *  Row Filter Descriptor - Port from Positron's rowFilterDescriptor.ts
 *  Provides typed filter descriptor classes for the row filter modal
 *--------------------------------------------------------------------------------------------*/

import {
    FilterComparisonOp,
    RowFilterCondition,
    RowFilterType,
    TextSearchType,
} from '@shared/dataExplorer';
import type { RowFilter, SchemaColumn } from '../../../../../dataGrid/types';
export {
    FilterComparisonOp,
    RowFilterCondition,
    RowFilterType,
    TextSearchType,
} from '@shared/dataExplorer';

/**
 * Generate a UUID for filter identification
 */
function generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * RowFilterDescrType enumeration.
 */
export enum RowFilterDescrType {
    // Filters with no parameters.
    IS_EMPTY = 'is-empty',
    IS_NOT_EMPTY = 'is-not-empty',
    IS_NULL = 'is-null',
    IS_NOT_NULL = 'is-not-null',
    IS_TRUE = 'is-true',
    IS_FALSE = 'is-false',

    // Filters with one parameter.
    IS_LESS_THAN = 'is-less-than',
    IS_LESS_OR_EQUAL = 'is-less-than-or-equal-to',
    IS_GREATER_THAN = 'is-greater-than',
    IS_GREATER_OR_EQUAL = 'is-greater-than-or-equal-to',
    IS_EQUAL_TO = 'is-equal-to',
    IS_NOT_EQUAL_TO = 'is-not-equal-to',
    SEARCH_CONTAINS = 'search-contains',
    SEARCH_NOT_CONTAINS = 'search-not-contains',
    SEARCH_STARTS_WITH = 'search-starts-with',
    SEARCH_ENDS_WITH = 'search-ends-with',
    SEARCH_REGEX_MATCHES = 'search-regex',

    // Filters with two parameters.
    IS_BETWEEN = 'is-between',
    IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * Common properties for row filters.
 */
interface RowFilterCommonProps {
    readonly condition: RowFilterCondition;
    readonly columnSchema: SchemaColumn;
    readonly isValid?: boolean;
    readonly errorMessage?: string;
}

/**
 * BaseRowFilterDescriptor class.
 */
abstract class BaseRowFilterDescriptor {
    readonly identifier: string;

    constructor(public readonly props: RowFilterCommonProps) {
        this.identifier = generateUuid();
    }

    abstract get descrType(): RowFilterDescrType;
    abstract get backendFilter(): RowFilter;

    get schema() {
        return this.props.columnSchema;
    }

    protected _sharedBackendParams() {
        return {
            filter_id: this.identifier,
            column_schema: this.props.columnSchema,
            condition: this.props.condition
        };
    }
}

// No-parameter filter descriptors

export class RowFilterDescriptorIsEmpty extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_EMPTY; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.IsEmpty,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsNotEmpty extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_NOT_EMPTY; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.NotEmpty,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsNull extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_NULL; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.IsNull,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsNotNull extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_NOT_NULL; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.NotNull,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsTrue extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_TRUE; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.IsTrue,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsFalse extends BaseRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_FALSE; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.IsFalse,
            is_valid: this.props.isValid ?? true,
            ...this._sharedBackendParams()
        };
    }
}

// Single-value filter descriptors

export abstract class SingleValueRowFilterDescriptor extends BaseRowFilterDescriptor {
    constructor(props: RowFilterCommonProps, public readonly value: string) {
        super(props);
    }
}

export class RowFilterDescriptorComparison extends SingleValueRowFilterDescriptor {
    private _descrType: RowFilterDescrType;

    constructor(props: RowFilterCommonProps, value: string, descrType: RowFilterDescrType) {
        super(props, value);
        this._descrType = descrType;
    }

    get descrType() { return this._descrType; }

    get operatorText(): string {
        switch (this.descrType) {
            case RowFilterDescrType.IS_EQUAL_TO: return '=';
            case RowFilterDescrType.IS_GREATER_OR_EQUAL: return '>=';
            case RowFilterDescrType.IS_GREATER_THAN: return '>';
            case RowFilterDescrType.IS_LESS_OR_EQUAL: return '<=';
            case RowFilterDescrType.IS_LESS_THAN: return '<';
            case RowFilterDescrType.IS_NOT_EQUAL_TO: return '!=';
            default: return '';
        }
    }

    private getCompareOp(): FilterComparisonOp {
        switch (this.descrType) {
            case RowFilterDescrType.IS_EQUAL_TO: return FilterComparisonOp.Eq;
            case RowFilterDescrType.IS_GREATER_OR_EQUAL: return FilterComparisonOp.GtEq;
            case RowFilterDescrType.IS_GREATER_THAN: return FilterComparisonOp.Gt;
            case RowFilterDescrType.IS_LESS_OR_EQUAL: return FilterComparisonOp.LtEq;
            case RowFilterDescrType.IS_LESS_THAN: return FilterComparisonOp.Lt;
            default: return FilterComparisonOp.NotEq;
        }
    }

    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.Compare,
            is_valid: this.props.isValid ?? true,
            params: { op: this.getCompareOp(), value: this.value },
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorSearch extends SingleValueRowFilterDescriptor {
    private _descrType: RowFilterDescrType;

    constructor(props: RowFilterCommonProps, value: string, descrType: RowFilterDescrType) {
        super(props, value);
        this._descrType = descrType;
    }

    get descrType() { return this._descrType; }

    get operatorText(): string {
        switch (this._descrType) {
            case RowFilterDescrType.SEARCH_CONTAINS: return 'contains';
            case RowFilterDescrType.SEARCH_NOT_CONTAINS: return 'does not contain';
            case RowFilterDescrType.SEARCH_STARTS_WITH: return 'starts with';
            case RowFilterDescrType.SEARCH_ENDS_WITH: return 'ends with';
            default: return 'matches regex';
        }
    }

    private getSearchType(): TextSearchType {
        switch (this._descrType) {
            case RowFilterDescrType.SEARCH_CONTAINS: return TextSearchType.Contains;
            case RowFilterDescrType.SEARCH_NOT_CONTAINS: return TextSearchType.NotContains;
            case RowFilterDescrType.SEARCH_STARTS_WITH: return TextSearchType.StartsWith;
            case RowFilterDescrType.SEARCH_ENDS_WITH: return TextSearchType.EndsWith;
            default: return TextSearchType.RegexMatch;
        }
    }

    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.Search,
            is_valid: this.props.isValid ?? true,
            params: {
                search_type: this.getSearchType(),
                term: this.value,
                case_sensitive: false
            },
            ...this._sharedBackendParams()
        };
    }
}

// Range filter descriptors

export abstract class RangeRowFilterDescriptor extends BaseRowFilterDescriptor {
    constructor(
        props: RowFilterCommonProps,
        public readonly lowerLimit: string,
        public readonly upperLimit: string
    ) {
        super(props);
    }
}

export class RowFilterDescriptorIsBetween extends RangeRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_BETWEEN; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.Between,
            is_valid: this.props.isValid ?? true,
            params: { left_value: this.lowerLimit, right_value: this.upperLimit },
            ...this._sharedBackendParams()
        };
    }
}

export class RowFilterDescriptorIsNotBetween extends RangeRowFilterDescriptor {
    get descrType() { return RowFilterDescrType.IS_NOT_BETWEEN; }
    get backendFilter(): RowFilter {
        return {
            filter_type: RowFilterType.NotBetween,
            is_valid: this.props.isValid ?? true,
            params: { left_value: this.lowerLimit, right_value: this.upperLimit },
            ...this._sharedBackendParams()
        };
    }
}

// Factory function

function getCompareDescrType(op: string): RowFilterDescrType {
    switch (op) {
        case FilterComparisonOp.Eq: return RowFilterDescrType.IS_EQUAL_TO;
        case FilterComparisonOp.NotEq: return RowFilterDescrType.IS_NOT_EQUAL_TO;
        case FilterComparisonOp.Lt: return RowFilterDescrType.IS_LESS_THAN;
        case FilterComparisonOp.LtEq: return RowFilterDescrType.IS_LESS_OR_EQUAL;
        case FilterComparisonOp.Gt: return RowFilterDescrType.IS_GREATER_THAN;
        case FilterComparisonOp.GtEq: return RowFilterDescrType.IS_GREATER_OR_EQUAL;
        default: return RowFilterDescrType.IS_EQUAL_TO;
    }
}

function getSearchDescrType(searchType: string): RowFilterDescrType {
    switch (searchType) {
        case TextSearchType.Contains: return RowFilterDescrType.SEARCH_CONTAINS;
        case TextSearchType.NotContains: return RowFilterDescrType.SEARCH_NOT_CONTAINS;
        case TextSearchType.EndsWith: return RowFilterDescrType.SEARCH_ENDS_WITH;
        case TextSearchType.StartsWith: return RowFilterDescrType.SEARCH_STARTS_WITH;
        case TextSearchType.RegexMatch: return RowFilterDescrType.SEARCH_REGEX_MATCHES;
        default: return RowFilterDescrType.SEARCH_CONTAINS;
    }
}

/**
 * Factory function to create a RowFilterDescriptor from a backend RowFilter.
 */
export function getRowFilterDescriptor(backendFilter: RowFilter): RowFilterDescriptor {
    const commonProps: RowFilterCommonProps = {
        columnSchema: backendFilter.column_schema,
        isValid: backendFilter.is_valid,
        errorMessage: backendFilter.error_message,
        condition: (backendFilter.condition as RowFilterCondition) ?? RowFilterCondition.And
    };

    switch (backendFilter.filter_type) {
        case RowFilterType.Compare: {
            const params = backendFilter.params as { op: string; value: string };
            return new RowFilterDescriptorComparison(commonProps, params.value, getCompareDescrType(params.op));
        }
        case RowFilterType.Between: {
            const params = backendFilter.params as { left_value: string; right_value: string };
            return new RowFilterDescriptorIsBetween(commonProps, params.left_value, params.right_value);
        }
        case RowFilterType.NotBetween: {
            const params = backendFilter.params as { left_value: string; right_value: string };
            return new RowFilterDescriptorIsNotBetween(commonProps, params.left_value, params.right_value);
        }
        case RowFilterType.IsEmpty:
            return new RowFilterDescriptorIsEmpty(commonProps);
        case RowFilterType.NotEmpty:
            return new RowFilterDescriptorIsNotEmpty(commonProps);
        case RowFilterType.IsNull:
            return new RowFilterDescriptorIsNull(commonProps);
        case RowFilterType.NotNull:
            return new RowFilterDescriptorIsNotNull(commonProps);
        case RowFilterType.IsTrue:
            return new RowFilterDescriptorIsTrue(commonProps);
        case RowFilterType.IsFalse:
            return new RowFilterDescriptorIsFalse(commonProps);
        case RowFilterType.Search: {
            const params = backendFilter.params as { search_type: string; term: string };
            return new RowFilterDescriptorSearch(commonProps, params.term, getSearchDescrType(params.search_type));
        }
        default:
            // Default to IsNull for unrecognized types
            return new RowFilterDescriptorIsNull(commonProps);
    }
}

/**
 * RowFilterDescriptor type union.
 */
export type RowFilterDescriptor =
    | RowFilterDescriptorComparison
    | RowFilterDescriptorIsEmpty
    | RowFilterDescriptorIsNotEmpty
    | RowFilterDescriptorIsNull
    | RowFilterDescriptorIsNotNull
    | RowFilterDescriptorIsTrue
    | RowFilterDescriptorIsFalse
    | RowFilterDescriptorIsBetween
    | RowFilterDescriptorIsNotBetween
    | RowFilterDescriptorSearch;

/**
 * Get available filter types for a column type.
 */
export function getAvailableFilterTypes(columnType: string): RowFilterDescrType[] {
    const commonFilters = [
        RowFilterDescrType.IS_NULL,
        RowFilterDescrType.IS_NOT_NULL,
        RowFilterDescrType.IS_EMPTY,
        RowFilterDescrType.IS_NOT_EMPTY
    ];

    const numericFilters = [
        RowFilterDescrType.IS_EQUAL_TO,
        RowFilterDescrType.IS_NOT_EQUAL_TO,
        RowFilterDescrType.IS_LESS_THAN,
        RowFilterDescrType.IS_LESS_OR_EQUAL,
        RowFilterDescrType.IS_GREATER_THAN,
        RowFilterDescrType.IS_GREATER_OR_EQUAL,
        RowFilterDescrType.IS_BETWEEN,
        RowFilterDescrType.IS_NOT_BETWEEN
    ];

    const stringFilters = [
        RowFilterDescrType.IS_EQUAL_TO,
        RowFilterDescrType.IS_NOT_EQUAL_TO,
        RowFilterDescrType.SEARCH_CONTAINS,
        RowFilterDescrType.SEARCH_NOT_CONTAINS,
        RowFilterDescrType.SEARCH_STARTS_WITH,
        RowFilterDescrType.SEARCH_ENDS_WITH,
        RowFilterDescrType.SEARCH_REGEX_MATCHES
    ];

    const booleanFilters = [
        RowFilterDescrType.IS_TRUE,
        RowFilterDescrType.IS_FALSE
    ];

    const type = columnType.toLowerCase();
    if (type.includes('bool') || type.includes('logical')) {
        return [...commonFilters, ...booleanFilters];
    } else if (
        type.includes('int') ||
        type.includes('float') ||
        type.includes('floating') ||
        type.includes('double') ||
        type.includes('decimal') ||
        type.includes('numeric') ||
        type.includes('number') ||
        type.includes('real')
    ) {
        return [...commonFilters, ...numericFilters];
    } else {
        return [...commonFilters, ...stringFilters];
    }
}

/**
 * Get display label for a filter type.
 */
export function getFilterTypeLabel(type: RowFilterDescrType): string {
    switch (type) {
        case RowFilterDescrType.IS_EMPTY: return 'Is empty';
        case RowFilterDescrType.IS_NOT_EMPTY: return 'Is not empty';
        case RowFilterDescrType.IS_NULL: return 'Is null';
        case RowFilterDescrType.IS_NOT_NULL: return 'Is not null';
        case RowFilterDescrType.IS_TRUE: return 'Is true';
        case RowFilterDescrType.IS_FALSE: return 'Is false';
        case RowFilterDescrType.IS_LESS_THAN: return 'Less than';
        case RowFilterDescrType.IS_LESS_OR_EQUAL: return 'Less than or equal';
        case RowFilterDescrType.IS_GREATER_THAN: return 'Greater than';
        case RowFilterDescrType.IS_GREATER_OR_EQUAL: return 'Greater than or equal';
        case RowFilterDescrType.IS_EQUAL_TO: return 'Equal to';
        case RowFilterDescrType.IS_NOT_EQUAL_TO: return 'Not equal to';
        case RowFilterDescrType.SEARCH_CONTAINS: return 'Contains';
        case RowFilterDescrType.SEARCH_NOT_CONTAINS: return 'Does not contain';
        case RowFilterDescrType.SEARCH_STARTS_WITH: return 'Starts with';
        case RowFilterDescrType.SEARCH_ENDS_WITH: return 'Ends with';
        case RowFilterDescrType.SEARCH_REGEX_MATCHES: return 'Matches regex';
        case RowFilterDescrType.IS_BETWEEN: return 'Between';
        case RowFilterDescrType.IS_NOT_BETWEEN: return 'Not between';
        default: return type;
    }
}

/**
 * Check if a filter type requires value input.
 */
export function filterTypeRequiresValue(type: RowFilterDescrType): boolean {
    const noValueFilters = [
        RowFilterDescrType.IS_EMPTY,
        RowFilterDescrType.IS_NOT_EMPTY,
        RowFilterDescrType.IS_NULL,
        RowFilterDescrType.IS_NOT_NULL,
        RowFilterDescrType.IS_TRUE,
        RowFilterDescrType.IS_FALSE
    ];
    return !noValueFilters.includes(type);
}

/**
 * Check if a filter type requires two values (range).
 */
export function filterTypeRequiresRange(type: RowFilterDescrType): boolean {
    return type === RowFilterDescrType.IS_BETWEEN || type === RowFilterDescrType.IS_NOT_BETWEEN;
}
