/*---------------------------------------------------------------------------------------------
 *  Data Explorer Service - compatibility shim
 *--------------------------------------------------------------------------------------------*/

export {
    PositronDataExplorerService as DataExplorerService,
} from './positronDataExplorerService';
export type {
    IPositronDataExplorerInstance as IDataExplorerInstance,
    IPositronDataExplorerService as IDataExplorerService,
    PositronDataExplorerCreateOptions as DataExplorerCreateOptions,
} from './positronDataExplorerService';
