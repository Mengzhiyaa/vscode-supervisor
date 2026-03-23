/*---------------------------------------------------------------------------------------------
 *  HelpEntry implementation
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IHelpEntry } from './interfaces/helpService';

/**
 * HelpEntry class.
 */
export class HelpEntry implements IHelpEntry {
    private _title?: string;
    private _scrollX = 0;
    private _scrollY = 0;

    private readonly _onDidChangeTitleEmitter = new vscode.EventEmitter<string>();

    constructor(
        public readonly sourceUrl: string,
        public readonly targetUrl: string,
        public readonly languageId: string,
        public readonly sessionId: string,
        public readonly languageName: string
    ) { }

    get title(): string | undefined {
        return this._title;
    }

    get scrollX(): number {
        return this._scrollX;
    }

    get scrollY(): number {
        return this._scrollY;
    }

    readonly onDidChangeTitle = this._onDidChangeTitleEmitter.event;

    setTitle(title?: string): void {
        if (title && title !== this._title) {
            this._title = title;
            this._onDidChangeTitleEmitter.fire(title);
        }
    }

    setScroll(scrollX: number, scrollY: number): void {
        this._scrollX = scrollX;
        this._scrollY = scrollY;
    }

    dispose(): void {
        this._onDidChangeTitleEmitter.dispose();
    }
}
