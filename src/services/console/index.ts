/*---------------------------------------------------------------------------------------------
 *  Console Service Module Exports
 *--------------------------------------------------------------------------------------------*/

// Interfaces
export {
    IPositronConsoleService,
    IPositronConsoleInstance,
    PositronConsoleState,
    SessionAttachMode,
    IConsoleCodeAttribution,
    ILanguageRuntimeCodeExecutedEvent
} from './interfaces/consoleService';

// Classes
export { PositronConsoleInstance } from './consoleInstance';
export { PositronConsoleService } from './consoleService';

// Runtime Items
export {
    RuntimeItem,
    RuntimeItemActivity,
    RuntimeItemStartup,
    RuntimeItemStarted,
    RuntimeItemRestarted,
    RuntimeItemReconnected,
    RuntimeItemExited,
    RuntimeItemTrace,
    ActivityItem,
    ActivityItemInput,
    ActivityItemInputState,
    ActivityItemStream,
    ActivityItemStreamType,
    ActivityItemErrorMessage,
    ActivityItemErrorSuggestion,
    ActivityItemOutputMessage,
    ActivityItemOutputHtml,
    ActivityItemOutputPlot,
    ActivityItemPrompt,
    ILanguageRuntimeMessageOutputData,
    ActivityItemOutput
} from './classes/runtimeItem';

export {
    ConsoleErrorFollowupService,
    MissingPackageErrorProvider,
    extractMissingPackageName,
} from './consoleErrorFollowup';
export type {
    ConsoleError,
    ConsoleErrorSuggestion,
    ConsoleErrorSuggestionProvider,
} from './consoleErrorFollowup';
