/**
 * Positron API Compatibility Layer
 * 
 * This module provides types and stubs for the Positron API that are used by
 * the supervisor code. In Positron IDE, these come from the 'positron' module.
 * For VS Code compatibility, we provide local definitions here.
 */

import * as vscode from 'vscode';
import { registerRuntimeClientInstance } from '../runtime/runtimeClientRegistry';
import {
    RuntimeMethodErrorCode,
    type LanguageRuntimeSession,
} from '../internal/runtimeTypes';

export * from '../api';
export * from '../internal/runtimeTypes';

let foregroundSessionProvider:
    (() => LanguageRuntimeSession | undefined | Promise<LanguageRuntimeSession | undefined>)
    | undefined;

let compatibilityContext: vscode.ExtensionContext | undefined;
let consoleWidthSourceDisposable: vscode.Disposable | undefined;
let consoleWidthProvider: (() => number | Promise<number>) | undefined;
let consoleWidthSourceBound = false;
const consoleWidthEmitter = new vscode.EventEmitter<number>();
const registeredEnvironmentContributions = new Map<string, EnvironmentVariableAction[]>();

export function initializePositronCompatibility(context: vscode.ExtensionContext): void {
    compatibilityContext = context;
    context.subscriptions.push(new vscode.Disposable(() => {
        if (compatibilityContext === context) {
            compatibilityContext = undefined;
        }
        consoleWidthSourceDisposable?.dispose();
        consoleWidthSourceDisposable = undefined;
        consoleWidthProvider = undefined;
        consoleWidthSourceBound = false;
        registeredEnvironmentContributions.clear();
    }));
}

/** Connects the compatibility API to the real Console width event. */
export function setConsoleWidthSource(
    event: vscode.Event<number>,
    getWidth?: () => number | Promise<number>,
): vscode.Disposable {
    consoleWidthSourceDisposable?.dispose();
    const registration = event(width => consoleWidthEmitter.fire(width));
    consoleWidthSourceDisposable = registration;
    consoleWidthProvider = getWidth;
    consoleWidthSourceBound = true;

    return new vscode.Disposable(() => {
        // A stale owner must not dispose a newer source registration.
        if (consoleWidthSourceDisposable === registration) {
            registration.dispose();
            consoleWidthSourceDisposable = undefined;
            consoleWidthProvider = undefined;
            consoleWidthSourceBound = false;
        }
    });
}

export function setForegroundSessionProvider(
    provider: typeof foregroundSessionProvider
): vscode.Disposable {
    foregroundSessionProvider = provider;
    return new vscode.Disposable(() => {
        if (foregroundSessionProvider === provider) {
            foregroundSessionProvider = undefined;
        }
    });
}

class PositronCompatibilityError extends Error {
    constructor(
        message: string,
        readonly code: RuntimeMethodErrorCode
    ) {
        super(message);
        this.name = 'PositronCompatibilityError';
    }
}

interface PositronRpcResult {
    result: unknown;
}

interface PositronRpcError {
    error: {
        code: RuntimeMethodErrorCode;
        message: string;
    };
}

type PositronRpcReply = PositronRpcResult | PositronRpcError;

function resultReply(result: unknown): PositronRpcResult {
    return { result };
}

function errorReply(
    code: RuntimeMethodErrorCode,
    message: string
): PositronRpcError {
    return {
        error: {
            code,
            message,
        },
    };
}

type WhenClauseTokenType =
    | 'identifier'
    | 'string'
    | 'number'
    | 'boolean'
    | 'operator'
    | 'lparen'
    | 'rparen';

interface WhenClauseToken {
    type: WhenClauseTokenType;
    value: string | number | boolean;
}

function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
    return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
    return /[A-Za-z0-9._-]/.test(char);
}

function readConfigurationValue(path: string): unknown {
    const parts = path.split('.');
    if (parts.length === 0) {
        return undefined;
    }

    if (parts.length === 1) {
        return vscode.workspace.getConfiguration().get(parts[0]);
    }

    const setting = parts[parts.length - 1];
    const section = parts.slice(0, -1).join('.');
    return vscode.workspace.getConfiguration(section).get(setting);
}

function readWhenClauseIdentifier(identifier: string): unknown {
    if (identifier.startsWith('config.')) {
        return readConfigurationValue(identifier.slice('config.'.length));
    }

    throw new Error(
        `Context key '${identifier}' is unavailable through the VS Code extension API; ` +
        'only config.* identifiers are supported'
    );
}

function compareWhenClauseValues(left: unknown, operator: string, right: unknown): boolean {
    const lhs = left as any;
    const rhs = right as any;

    switch (operator) {
        case '==':
            // Intentional loose equality to match VS Code context key semantics.
            // eslint-disable-next-line eqeqeq
            return lhs == rhs;
        case '!=':
            // Intentional loose inequality to match VS Code context key semantics.
            // eslint-disable-next-line eqeqeq
            return lhs != rhs;
        case '>':
            return lhs > rhs;
        case '>=':
            return lhs >= rhs;
        case '<':
            return lhs < rhs;
        case '<=':
            return lhs <= rhs;
        default:
            throw new Error(`Unsupported when clause operator '${operator}'`);
    }
}

function tokenizeWhenClause(whenClause: string): WhenClauseToken[] {
    const tokens: WhenClauseToken[] = [];

    for (let index = 0; index < whenClause.length;) {
        const char = whenClause[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        if (char === '(') {
            tokens.push({ type: 'lparen', value: char });
            index += 1;
            continue;
        }

        if (char === ')') {
            tokens.push({ type: 'rparen', value: char });
            index += 1;
            continue;
        }

        const twoCharOperator = whenClause.slice(index, index + 2);
        if (['&&', '||', '==', '!=', '>=', '<='].includes(twoCharOperator)) {
            tokens.push({ type: 'operator', value: twoCharOperator });
            index += 2;
            continue;
        }

        if (['!', '>', '<'].includes(char)) {
            tokens.push({ type: 'operator', value: char });
            index += 1;
            continue;
        }

        if (char === '\'') {
            let value = '';
            index += 1;

            while (index < whenClause.length) {
                const next = whenClause[index];
                if (next === '\\' && index + 1 < whenClause.length) {
                    value += whenClause[index + 1];
                    index += 2;
                    continue;
                }
                if (next === '\'') {
                    break;
                }
                value += next;
                index += 1;
            }

            if (index >= whenClause.length || whenClause[index] !== '\'') {
                throw new Error(`Unterminated string literal in when clause '${whenClause}'`);
            }

            tokens.push({ type: 'string', value });
            index += 1;
            continue;
        }

        if (isDigit(char)) {
            let end = index + 1;
            while (end < whenClause.length && /[\d.]/.test(whenClause[end])) {
                end += 1;
            }
            tokens.push({
                type: 'number',
                value: Number(whenClause.slice(index, end)),
            });
            index = end;
            continue;
        }

        if (isIdentifierStart(char)) {
            let end = index + 1;
            while (end < whenClause.length && isIdentifierPart(whenClause[end])) {
                end += 1;
            }

            const identifier = whenClause.slice(index, end);
            if (identifier === 'true' || identifier === 'false') {
                tokens.push({
                    type: 'boolean',
                    value: identifier === 'true',
                });
            } else {
                tokens.push({
                    type: 'identifier',
                    value: identifier,
                });
            }
            index = end;
            continue;
        }

        throw new Error(`Unexpected token '${char}' in when clause '${whenClause}'`);
    }

    return tokens;
}

class WhenClauseParser {
    private _index = 0;

    constructor(private readonly _tokens: WhenClauseToken[]) { }

    parse(): boolean {
        const result = this._parseOr();
        if (this._peek()) {
            throw new Error(`Unexpected trailing token '${this._peek()!.value}' in when clause`);
        }
        return result;
    }

    private _parseOr(): boolean {
        let result = this._parseAnd();
        while (this._matchOperator('||')) {
            const right = this._parseAnd();
            result = result || right;
        }
        return result;
    }

    private _parseAnd(): boolean {
        let result = this._parseUnary();
        while (this._matchOperator('&&')) {
            const right = this._parseUnary();
            result = result && right;
        }
        return result;
    }

    private _parseUnary(): boolean {
        if (this._matchOperator('!')) {
            return !this._parseUnary();
        }
        return this._parsePrimary();
    }

    private _parsePrimary(): boolean {
        if (this._match('lparen')) {
            const result = this._parseOr();
            this._expect('rparen');
            return result;
        }

        const left = this._parseValue(true);
        const operator = this._peek();
        if (operator?.type === 'operator' && ['==', '!=', '>', '>=', '<', '<='].includes(String(operator.value))) {
            this._advance();
            const right = this._parseValue(false);
            return compareWhenClauseValues(left, String(operator.value), right);
        }

        return Boolean(left);
    }

    private _parseValue(resolveIdentifier: boolean): unknown {
        const token = this._advance();
        if (!token) {
            throw new Error('Unexpected end of when clause');
        }

        switch (token.type) {
            case 'identifier':
                return resolveIdentifier
                    ? readWhenClauseIdentifier(String(token.value))
                    : token.value;
            case 'string':
            case 'number':
            case 'boolean':
                return token.value;
            default:
                throw new Error(`Unexpected token '${token.value}' in when clause`);
        }
    }

    private _peek(): WhenClauseToken | undefined {
        return this._tokens[this._index];
    }

    private _advance(): WhenClauseToken | undefined {
        const token = this._tokens[this._index];
        this._index += 1;
        return token;
    }

    private _match(type: WhenClauseTokenType): boolean {
        const token = this._peek();
        if (!token || token.type !== type) {
            return false;
        }
        this._advance();
        return true;
    }

    private _expect(type: WhenClauseTokenType): void {
        if (!this._match(type)) {
            const token = this._peek();
            throw new Error(`Expected ${type} but found '${token?.value ?? 'end of input'}'`);
        }
    }

    private _matchOperator(operator: string): boolean {
        const token = this._peek();
        if (!token || token.type !== 'operator' || token.value !== operator) {
            return false;
        }
        this._advance();
        return true;
    }
}

function evaluateWhenClause(whenClause: string): boolean {
    try {
        return new WhenClauseParser(tokenizeWhenClause(whenClause)).parse();
    } catch (error) {
        throw new PositronCompatibilityError(
            `Failed to evaluate when clause '${whenClause}': ${error instanceof Error ? error.message : String(error)}`,
            RuntimeMethodErrorCode.InvalidParams
        );
    }
}

async function executeCompatCommand(commandId: string): Promise<unknown> {
    const result = await vscode.commands.executeCommand(commandId);
    return result === undefined ? null : result;
}

function readStringParam(
    methodName: string,
    params: unknown,
    key: string
): string {
    if (!params || typeof params !== 'object') {
        throw new PositronCompatibilityError(
            `Missing params for '${methodName}'`,
            RuntimeMethodErrorCode.InvalidParams
        );
    }

    const value = (params as Record<string, unknown>)[key];
    if (typeof value !== 'string') {
        throw new PositronCompatibilityError(
            `Expected string param '${key}' for '${methodName}'`,
            RuntimeMethodErrorCode.InvalidParams
        );
    }

    return value;
}

// ============================================================================
// Runtime Methods
// ============================================================================

export const methods = {
    async call(methodName: string, params?: unknown): Promise<PositronRpcReply> {
        try {
            switch (methodName) {
                case 'evaluate_when_clause': {
                    const whenClause = readStringParam(methodName, params, 'when_clause');
                    return resultReply(evaluateWhenClause(whenClause));
                }

                case 'execute_command': {
                    const commandId = readStringParam(methodName, params, 'command');
                    return resultReply(await executeCompatCommand(commandId));
                }

                default:
                    return errorReply(
                        RuntimeMethodErrorCode.MethodNotFound,
                        `Unsupported method '${methodName}'`
                    );
            }
        } catch (error) {
            if (error instanceof PositronCompatibilityError) {
                return errorReply(error.code, error.message);
            }
            return errorReply(
                RuntimeMethodErrorCode.InternalError,
                error instanceof Error ? error.message : String(error)
            );
        }
    },
};

// ============================================================================
// Positron Window API compatibility bridge
// ============================================================================

export const window = {
    createRawLogOutputChannel(name: string): vscode.LogOutputChannel {
        // VS Code cannot disable log-channel prefixes, but returning a real
        // LogOutputChannel preserves the public API shape and log methods.
        return vscode.window.createOutputChannel(name, { log: true });
    },

    onDidChangeConsoleWidth: consoleWidthEmitter.event,

    async getConsoleWidth(): Promise<number> {
        if (!consoleWidthProvider) {
            throw new PositronCompatibilityError(
                'Console width is unavailable before the Console service is initialized',
                RuntimeMethodErrorCode.InternalError,
            );
        }
        return consoleWidthProvider();
    },

    async showSimpleModalDialogMessage(
        title: string,
        message: string,
        okButtonTitle?: string
    ): Promise<null> {
        await vscode.window.showInformationMessage(
            title,
            { modal: true, detail: message },
            okButtonTitle ?? vscode.l10n.t('OK'),
        );
        return null;
    },

    async showSimpleModalDialogPrompt(
        title: string,
        message: string,
        okButtonTitle?: string,
        cancelButtonTitle?: string
    ): Promise<boolean> {
        const ok = okButtonTitle ?? vscode.l10n.t('OK');
        const cancel = cancelButtonTitle ?? vscode.l10n.t('Cancel');
        const result = await vscode.window.showWarningMessage(
            title,
            { modal: true, detail: message },
            ok,
            cancel,
        );
        return result === ok;
    },

    async showSimpleModalDialogInputPrompt(
        title: string,
        message: string,
        placeholder?: string,
    ): Promise<string | undefined> {
        // VS Code has no modal input API. showInputBox is the closest public,
        // cancellable equivalent and is reported as a fallback capability.
        return vscode.window.showInputBox({
            title,
            prompt: message,
            placeHolder: placeholder,
        });
    },
};

// ============================================================================
// Positron Runtime API compatibility bridge
// ============================================================================

export const runtime = {
    registerClientInstance(clientId: string): vscode.Disposable {
        return registerRuntimeClientInstance(clientId);
    },

    async getForegroundSession(): Promise<LanguageRuntimeSession | undefined> {
        return foregroundSessionProvider?.();
    },
};

// ============================================================================
// Positron Environment API compatibility bridge
// ============================================================================

export interface EnvironmentVariableAction {
    action: vscode.EnvironmentVariableMutatorType;
    name: string;
    value: string;
}

/**
 * Registers environment mutations owned by another extension. VS Code's
 * public API only exposes an extension's own collection, so language
 * extensions use this explicit bridge to provide Positron-equivalent data.
 */
export function registerEnvironmentContributions(
    extensionId: string,
    actions: readonly EnvironmentVariableAction[],
): vscode.Disposable {
    const registration = actions.map(action => ({ ...action }));
    registeredEnvironmentContributions.set(extensionId, registration);
    return new vscode.Disposable(() => {
        const current = registeredEnvironmentContributions.get(extensionId);
        if (current === registration) {
            registeredEnvironmentContributions.delete(extensionId);
        }
    });
}

export const environment = {
    async getEnvironmentContributions(): Promise<Record<string, EnvironmentVariableAction[]>> {
        const result: Record<string, EnvironmentVariableAction[]> = Object.create(null);
        for (const [extensionId, actions] of registeredEnvironmentContributions) {
            result[extensionId] = actions.map(action => ({ ...action }));
        }

        const context = compatibilityContext;
        if (context) {
            const ownActions: EnvironmentVariableAction[] = [];
            context.environmentVariableCollection.forEach((name, mutator) => {
                ownActions.push({
                    action: mutator.type,
                    name,
                    value: mutator.value,
                });
            });
            if (ownActions.length > 0) {
                result[context.extension.id] = ownActions;
            }
        }

        return result;
    },
};

export interface PositronCompatibilityCapabilities {
    readonly consoleWidthEvents: boolean;
    readonly consoleWidthValue: boolean;
    readonly modalDialogs: true;
    readonly modalInput: 'quick-input-fallback';
    readonly rawLogOutput: 'vscode-log-output-fallback';
    readonly environmentContributions: 'registered-and-own-extension';
    readonly whenClauseEvaluation: 'configuration-subset';
}

export function getPositronCompatibilityCapabilities(): PositronCompatibilityCapabilities {
    return {
        consoleWidthEvents: consoleWidthSourceBound,
        consoleWidthValue: consoleWidthProvider !== undefined,
        modalDialogs: true,
        modalInput: 'quick-input-fallback',
        rawLogOutput: 'vscode-log-output-fallback',
        environmentContributions: 'registered-and-own-extension',
        whenClauseEvaluation: 'configuration-subset',
    };
}

// ============================================================================
// Version info
// ============================================================================

export const version = '1.0.0';
export const buildNumber = 1;
