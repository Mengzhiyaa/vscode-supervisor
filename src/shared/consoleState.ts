import type {
    ActivityItemInputState,
    ActivityItemPromptState,
    ActivityItemStreamType,
    ILanguageRuntimeMessageOutputData,
} from './console';

export interface SerializedConsoleState {
    version: 1 | 2;
    items: SerializedRuntimeItem[];
    inputHistory: string[];
    trace: boolean;
    wordWrap: boolean;
    inputPrompt?: string;
    continuationPrompt?: string;
    workingDirectory?: string;
}

export type SerializedRuntimeItem =
    | SerializedRuntimeActivity
    | SerializedRuntimeStarted
    | SerializedRuntimeRestarted
    | SerializedRuntimeStartup
    | SerializedRuntimeStartupFailure
    | SerializedRuntimeExited
    | SerializedRuntimeOffline
    | SerializedRuntimePendingInput
    | SerializedRuntimeTrace
    | SerializedRuntimeStarting
    | SerializedRuntimeReconnected;

export interface SerializedRuntimeActivity {
    type: 'activity';
    parentId: string;
    items: SerializedActivityItem[];
}

export interface SerializedRuntimeStarted {
    type: 'started';
    id: string;
    when: number;
    sessionName: string;
}

export interface SerializedRuntimeRestarted {
    type: 'restarted';
    id: string;
    when: number;
    sessionName: string;
}

export interface SerializedRuntimeStartup {
    type: 'startup';
    id: string;
    when: number;
    banner: string;
    version: string;
}

export interface SerializedRuntimeStartupFailure {
    type: 'startupFailure';
    id: string;
    when: number;
    message: string;
    details: string;
}

export interface SerializedRuntimeExited {
    type: 'exited';
    id: string;
    when: number;
    sessionName: string;
    exitCode: number;
    reason: string;
}

export interface SerializedRuntimeOffline {
    type: 'offline';
    id: string;
    when: number;
    sessionName: string;
    reason: string;
}

export interface SerializedRuntimePendingInput {
    type: 'pendingInput';
    id: string;
    when: number;
    inputPrompt?: string;
    code?: string;
    // Legacy restore-state key used by older snapshots.
    prompt?: string;
}

export interface SerializedRuntimeTrace {
    type: 'trace';
    id: string;
    when: number;
    trace: string;
}

export interface SerializedRuntimeStarting {
    type: 'starting';
    id: string;
    when: number;
    message: string;
    attachMode: string;
    sessionName?: string;
}

export interface SerializedRuntimeReconnected {
    type: 'reconnected';
    id: string;
    when: number;
    sessionName: string;
}

export type SerializedActivityItem =
    | SerializedActivityInput
    | SerializedActivityStream
    | SerializedActivityError
    | SerializedActivityOutput
    | SerializedActivityOutputHtml
    | SerializedActivityOutputPlot
    | SerializedActivityPrompt;

export interface SerializedActivityInput {
    type: 'input';
    id: string;
    parentId: string;
    when: number;
    state: ActivityItemInputState;
    inputPrompt: string;
    continuationPrompt: string;
    code: string;
}

export interface SerializedActivityStream {
    type: 'stream';
    id: string;
    parentId: string;
    when: number;
    streamType: ActivityItemStreamType;
    text: string;
}

export interface SerializedActivityError {
    type: 'error';
    id: string;
    parentId: string;
    when: number;
    name: string;
    message: string;
    traceback: string[];
}

export interface SerializedActivityOutput {
    type: 'output';
    id: string;
    parentId: string;
    when: number;
    data: ILanguageRuntimeMessageOutputData;
    outputId?: string;
}

export interface SerializedActivityOutputHtml {
    type: 'outputHtml';
    id: string;
    parentId: string;
    when: number;
    html: string;
    resource?: string;
    outputId?: string;
}

export interface SerializedActivityOutputPlot {
    type: 'outputPlot';
    id: string;
    parentId: string;
    when: number;
    data: ILanguageRuntimeMessageOutputData;
    outputId?: string;
}

export interface SerializedActivityPrompt {
    type: 'prompt';
    id: string;
    parentId: string;
    when: number;
    prompt: string;
    password: boolean;
    state?: ActivityItemPromptState;
    answer?: string;
}
