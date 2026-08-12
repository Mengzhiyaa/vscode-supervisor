import * as vscode from 'vscode';
import { dispatchStructuredLog, formatLogContext } from './logSinks';

let frameworkLogChannel: vscode.LogOutputChannel | undefined;

export function registerFrameworkLogChannel(channel: vscode.LogOutputChannel): vscode.Disposable {
    frameworkLogChannel = channel;
    return new vscode.Disposable(() => {
        if (frameworkLogChannel === channel) {
            frameworkLogChannel = undefined;
        }
    });
}

export function logFrameworkDiagnostic(
    component: string,
    message: string,
    level: vscode.LogLevel = vscode.LogLevel.Warning,
    context?: { session?: string; operation?: string },
): void {
    if (!frameworkLogChannel) {
        return;
    }
    dispatchStructuredLog(
        frameworkLogChannel,
        formatLogContext(component, message, context),
        level,
    );
}
