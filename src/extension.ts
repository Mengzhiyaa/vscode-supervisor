import * as vscode from 'vscode';
import type { ISupervisorFrameworkApi } from './api';
import { SupervisorApplication } from './application';

let app: SupervisorApplication | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<ISupervisorFrameworkApi> {
    app = new SupervisorApplication(context);
    await app.activate();
    return app.getApi();
}

export async function deactivate(): Promise<void> {
    if (app) {
        await app.shutdown();
        app = undefined;
    }
}
