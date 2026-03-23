import type { IRuntimeClientEvent } from './comms/positronUiComm';

/**
 * A runtime-global UI event with originating session ID.
 */
export interface ILanguageRuntimeGlobalEvent {
    /** The ID of the session from which the event originated. */
    session_id: string;

    /** The runtime UI event payload. */
    event: IRuntimeClientEvent;
}
