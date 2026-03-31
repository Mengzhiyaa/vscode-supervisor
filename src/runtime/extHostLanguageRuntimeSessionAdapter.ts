import * as vscode from 'vscode';
import type { JupyterLanguageRuntimeSession } from '../supervisor/positron-supervisor';
import {
    type LanguageRuntimeMessage,
    type LanguageRuntimeMessageCommClosed,
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    LanguageRuntimeMessageType,
} from '../internal/runtimeTypes';
import type { RuntimeClientManager } from './runtimeClientManager';
import type { RuntimeSession } from './session';

/**
 * Positron-style ext-host adapter for runtime messages.
 *
 * It stamps event_clock, pre-handles client comm traffic, and forwards the
 * message plus handled state to the runtime session queue.
 */
export class ExtHostLanguageRuntimeSessionAdapter implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _session: RuntimeSession,
        kernel: JupyterLanguageRuntimeSession,
        private readonly _clientManager: RuntimeClientManager,
        private readonly _nextEventClock: () => number,
    ) {
        this._disposables.push(
            kernel.onDidReceiveRuntimeMessage((message) => {
                this.handleRuntimeMessage(message as LanguageRuntimeMessage);
            })
        );
    }

    handleRuntimeMessage(message: LanguageRuntimeMessage): boolean {
        const runtimeMessage: LanguageRuntimeMessage = {
            ...message,
            event_clock: message.event_clock > 0
                ? message.event_clock
                : this._nextEventClock(),
        };

        this._session.log(
            `<<< RECV ${runtimeMessage.type}: ${this._stringifyMessageContent(runtimeMessage)}`,
            vscode.LogLevel.Debug
        );

        let handled = false;
        switch (runtimeMessage.type) {
            case LanguageRuntimeMessageType.CommOpen:
                handled = this._clientManager.handleCommOpen(
                    runtimeMessage as LanguageRuntimeMessageCommOpen
                );
                break;

            case LanguageRuntimeMessageType.CommData:
                handled = this._clientManager.handleCommData(
                    runtimeMessage as LanguageRuntimeMessageCommData
                );
                break;

            case LanguageRuntimeMessageType.CommClosed:
                handled = this._clientManager.handleCommClosed(
                    (runtimeMessage as LanguageRuntimeMessageCommClosed).comm_id
                );
                break;
        }

        this._session.handleRuntimeMessage(runtimeMessage, handled);
        return handled;
    }

    dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private _stringifyMessageContent(message: LanguageRuntimeMessage): string {
        const content = (message as Partial<{ data: unknown }>).data ?? message;

        try {
            return JSON.stringify(content);
        } catch {
            return String(content);
        }
    }
}
