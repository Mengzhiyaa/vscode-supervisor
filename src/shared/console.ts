export enum ActivityItemPromptState {
    Unanswered = 'Unanswered',
    Answered = 'Answered',
    Interrupted = 'Interrupted',
}

export enum ActivityItemStreamType {
    OUTPUT = 'output',
    ERROR = 'error',
}

export enum ActivityItemInputState {
    Provisional = 'provisional',
    Executing = 'executing',
    Completed = 'completed',
    Cancelled = 'cancelled',
    /**
     * The extension host was reloaded while the input was provisional or
     * executing and the reconnected runtime could not prove its final state.
     * This state is deliberately non-executable: restoring it must never
     * enqueue or re-run the original code.
     */
    UnknownAfterReload = 'unknown-after-reload',
}

export type ILanguageRuntimeMessageOutputData = {
    [mimeType: string]: string | undefined;
};

export interface ConsoleThemeRule {
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export interface ConsoleThemeData {
    base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
    rules: ConsoleThemeRule[];
    fileIconThemeSettingsId?: string;
}

export function deserializePromptState(
    value: string | undefined,
): ActivityItemPromptState | undefined {
    switch (value) {
        case ActivityItemPromptState.Unanswered:
        case 'unanswered':
            return ActivityItemPromptState.Unanswered;
        case ActivityItemPromptState.Answered:
        case 'answered':
            return ActivityItemPromptState.Answered;
        case ActivityItemPromptState.Interrupted:
        case 'interrupted':
            return ActivityItemPromptState.Interrupted;
        default:
            return undefined;
    }
}
