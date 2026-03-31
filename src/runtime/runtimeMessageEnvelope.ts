import {
    type LanguageRuntimeMessage,
    type LanguageRuntimeMessageType,
    type RuntimeState,
} from '../internal/runtimeTypes';

/**
 * Base queued runtime event.
 */
export abstract class QueuedRuntimeEvent {
    constructor(readonly clock: number) {
    }

    abstract summary(): string;
}

/**
 * Queued runtime message event.
 */
export class QueuedRuntimeMessageEvent extends QueuedRuntimeEvent {
    constructor(
        clock: number,
        readonly handled: boolean,
        readonly message: LanguageRuntimeMessage,
    ) {
        super(clock);
    }

    summary(): string {
        const type = this.message.type as LanguageRuntimeMessageType;
        return `message:${type}`;
    }
}

/**
 * Queued runtime state event.
 */
export class QueuedRuntimeStateEvent extends QueuedRuntimeEvent {
    constructor(
        clock: number,
        readonly state: RuntimeState,
    ) {
        super(clock);
    }

    summary(): string {
        return `state:${this.state}`;
    }
}
