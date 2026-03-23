/*---------------------------------------------------------------------------------------------
 *  Console Classes Index - Re-exports all console runtime and activity item classes.
 *--------------------------------------------------------------------------------------------*/

// Base classes
export {
    RuntimeItem,
    RuntimeItemStandard,
    RuntimeItemExited,
    RuntimeItemOffline,
    RuntimeItemPendingInput,
    RuntimeItemStarting,
    RuntimeItemRestartButton,
    RuntimeItemTrace,
    RuntimeItemRestarting
} from './runtimeItem';
export { ActivityItem } from './activityItem';

// Activity item classes - Input
export { ActivityItemInput, ActivityItemInputState } from './activityItemInput';

// Activity item classes - Stream
export { ActivityItemStream, ActivityItemStreamType } from './activityItemStream';

// Activity item classes - Error
export { ActivityItemErrorMessage } from './activityItemErrorMessage';

// Activity item classes - Prompt (Positron-style)
export { ActivityItemPrompt, ActivityItemPromptState } from './activityItemPrompt';

// Activity item classes - Output (Positron-style)
export { ActivityItemOutputHtml } from './activityItemOutputHtml';
export { ActivityItemOutputMessage, type ILanguageRuntimeMessageOutputData } from './activityItemOutputMessage';
export { ActivityItemOutputPlot } from './activityItemOutputPlot';

// Activity output type alias (Positron pattern)
export type { ActivityItemOutput } from './runtimeItemActivity';

// Runtime item classes
export { RuntimeItemActivity } from './runtimeItemActivity';
export { RuntimeItemStarted } from './runtimeItemStarted';
export { RuntimeItemStartup } from './runtimeItemStartup';
export { RuntimeItemReconnected } from './runtimeItemReconnected';
export { RuntimeItemStartupFailure } from './runtimeItemStartupFailure';

// Utility classes
export { ThrottledEmitter } from './throttledEmitter';

// Output line type (for ConsoleOutputLines component)
export type { ANSIOutputLine as OutputLine } from '$lib/ansi/ansiOutput';
