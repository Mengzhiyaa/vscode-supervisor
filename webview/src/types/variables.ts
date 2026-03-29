/**
 * Variables types for the webview.
 * Re-export the shared wire/UI shapes so the webview does not maintain a
 * second copy of the same protocol-facing types.
 */

export type {
    IVariableGroup,
    IVariableItem,
    IVariableOverflow,
    VariableEntry,
    VariablesGrouping,
    VariablesInstanceInfo,
    VariablesInstanceState,
    VariablesInstanceStatus,
    VariablesSorting,
} from '@shared/variables';
export {
    isVariableGroup,
    isVariableItem,
    isVariableOverflow,
} from '@shared/variables';

/**
 * Variables instance information for session selection.
 */
export interface VariablesInstance {
    id: string;
    sessionName: string;
    runtimeName: string;
    state?: import('@shared/variables').VariablesInstanceState;
    status?: import('@shared/variables').VariablesInstanceStatus;
}
