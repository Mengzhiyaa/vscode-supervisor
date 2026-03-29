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
