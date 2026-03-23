/*---------------------------------------------------------------------------------------------
 *  Debug startup helpers for ARK kernel sessions.
 *  Based on positron-r startup flow.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { delay } from '../supervisor/util';
import { JupyterKernelExtra } from '../types/positron-supervisor';

/**
 * Helps a debugger attach to the ARK kernel at startup by using a notifier file.
 */
export class AttachOnStartup {
    private _delayDir?: string;
    private _delayFile?: string;

    init(args: Array<string>) {
        // Ensure temp directory is created inside os.tmpdir() on all platforms.
        this._delayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'JupyterDelayStartup-'));
        this._delayFile = path.join(this._delayDir, 'file');

        fs.writeFileSync(this._delayFile, 'create\n');

        // Push before '--' because arguments after '--' are forwarded to R.
        let loc = args.findIndex((elt) => elt === '--');
        if (loc === -1) {
            loc = args.length;
        }

        args.splice(loc, 0, '--startup-notifier-file', this._delayFile);
    }

    async attach() {
        await vscode.commands.executeCommand('workbench.action.debug.start');
        fs.writeFileSync(this._delayFile!, 'go\n');

        void delay(100).then(() => {
            fs.rmSync(this._delayDir!, { recursive: true, force: true });
        });
    }
}

/**
 * Delays kernel startup by a given number of seconds.
 */
export class DelayStartup {
    init(args: Array<string>, delaySeconds: number) {
        let loc = args.findIndex((elt) => elt === '--');
        if (loc === -1) {
            loc = args.length;
        }

        args.splice(loc, 0, '--startup-delay', delaySeconds.toString());
    }
}

/**
 * Creates startup extras passed to Kallichore session creation.
 */
export function createJupyterKernelExtra(): JupyterKernelExtra {
    return {
        attachOnStartup: new AttachOnStartup(),
        sleepOnStartup: new DelayStartup(),
    };
}
