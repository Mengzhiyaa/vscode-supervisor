import * as vscode from 'vscode';
import { RuntimeSessionService } from './runtimeSession';

/**
 * Compatibility shim while the codebase migrates from SessionManager to the
 * Positron-aligned RuntimeSessionService naming.
 */
export class SessionManager extends RuntimeSessionService {
    constructor(
        context: vscode.ExtensionContext,
        outputChannel: vscode.LogOutputChannel,
    ) {
        super(context, outputChannel);
    }
}
