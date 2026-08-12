import * as vscode from 'vscode';
import * as os from 'os';

/** A sink for messages whose final formatting is owned by VS Code. */
export interface IStructuredLogSink {
    readonly logLevel: vscode.LogLevel;
    trace(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string | Error, ...args: unknown[]): void;
    show(preserveFocus?: boolean): void;
}

/** A sink for producer-formatted text that must not receive VS Code log prefixes. */
export interface IRawLogSink {
    append(value: string): void;
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
}

/** Applies redaction to every write while preserving LogOutputChannel behavior. */
export class RedactingLogOutputChannel implements vscode.LogOutputChannel {
    constructor(private readonly channel: vscode.LogOutputChannel) {}

    get name(): string { return this.channel.name; }
    get logLevel(): vscode.LogLevel { return this.channel.logLevel; }
    get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> { return this.channel.onDidChangeLogLevel; }
    append(value: string): void { this.channel.append(normalizeStructuredMessage(value)); }
    appendLine(value: string): void { this.channel.appendLine(normalizeStructuredMessage(value)); }
    replace(value: string): void { this.channel.replace(normalizeStructuredMessage(value)); }
    clear(): void { this.channel.clear(); }
    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (typeof columnOrPreserveFocus === 'boolean' || columnOrPreserveFocus === undefined) {
            this.channel.show(columnOrPreserveFocus);
        } else {
            this.channel.show(preserveFocus);
        }
    }
    hide(): void { this.channel.hide(); }
    trace(message: string, ...args: unknown[]): void { this.channel.trace(normalizeStructuredMessage(message), ...redactLogArgs(args)); }
    debug(message: string, ...args: unknown[]): void { this.channel.debug(normalizeStructuredMessage(message), ...redactLogArgs(args)); }
    info(message: string, ...args: unknown[]): void { this.channel.info(normalizeStructuredMessage(message), ...redactLogArgs(args)); }
    warn(message: string, ...args: unknown[]): void { this.channel.warn(normalizeStructuredMessage(message), ...redactLogArgs(args)); }
    error(message: string | Error, ...args: unknown[]): void {
        this.channel.error(
            typeof message === 'string' ? normalizeStructuredMessage(message) : redactError(message),
            ...redactLogArgs(args),
        );
    }
    dispose(): void { this.channel.dispose(); }
}

export function dispatchStructuredLog(
    sink: IStructuredLogSink,
    message: string | Error,
    level: vscode.LogLevel = vscode.LogLevel.Info,
): void {
    const redactedMessage = message instanceof Error
        ? redactError(message)
        : redactLogMessage(message);
    switch (level) {
        case vscode.LogLevel.Error:
            sink.error(redactedMessage);
            break;
        case vscode.LogLevel.Warning:
            sink.warn(redactedMessage instanceof Error ? redactedMessage.message : redactedMessage);
            break;
        case vscode.LogLevel.Debug:
            sink.debug(redactedMessage instanceof Error ? redactedMessage.message : redactedMessage);
            break;
        case vscode.LogLevel.Trace:
            sink.trace(redactedMessage instanceof Error ? redactedMessage.message : redactedMessage);
            break;
        case vscode.LogLevel.Info:
        default:
            sink.info(redactedMessage instanceof Error ? redactedMessage.message : redactedMessage);
            break;
    }
}

export function truncateStructuredMessage(message: string, maximumLength = 2048): string {
    return message.length > maximumLength
        ? `${message.substring(0, maximumLength)}... (truncated)`
        : message;
}

/** Formats an extension-owned event before it is inserted into a raw stream. */
export function formatRawSupervisorLine(
    message: string,
    level: vscode.LogLevel = vscode.LogLevel.Info,
    now = new Date(),
): string {
    const severity = level === vscode.LogLevel.Error
        ? ' [error]'
        : level === vscode.LogLevel.Warning
            ? ' [warn]'
            : level === vscode.LogLevel.Debug
                ? ' [debug]'
                : level === vscode.LogLevel.Trace
                    ? ' [trace]'
                    : '';
    return `${now.toISOString().substring(11, 19)} [Supervisor Extension]${severity} ${redactLogMessage(message)}`;
}

/** Creates a stable, searchable context prefix for structured diagnostics. */
export function formatLogContext(
    component: string,
    message: string,
    context: { session?: string; operation?: string } = {},
): string {
    const fields = [`component=${component}`];
    if (context.session) {
        fields.push(`session=${context.session}`);
    }
    if (context.operation) {
        fields.push(`operation=${context.operation}`);
    }
    return `${fields.join(' ')} ${message}`;
}

/** Removes common credentials and user-home paths before text reaches an Output channel. */
export function redactLogMessage(message: string): string {
    let redacted = message
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
        .replace(
            /((?:bearer[_-]?token|access[_-]?token|api[_-]?key|password|passwd|secret)\s*[=:]\s*["']?)[^"'\s,;}]+/gi,
            '$1<redacted>',
        )
        .replace(
            /((?:--?(?:bearer[-_]?token|access[-_]?token|api[-_]?key|token|password|passwd|secret))(?:\s+|=))[^\s]+/gi,
            '$1<redacted>',
        );
    const home = os.homedir();
    if (home && home !== '/') {
        redacted = redacted.split(home).join('<home>');
    }
    return redacted;
}

function normalizeStructuredMessage(message: string): string {
    return redactLogMessage(message).replace(/^\[([A-Za-z][A-Za-z0-9_-]*)\]\s*/, 'component=$1 ');
}

function redactLogArgs(args: readonly unknown[]): unknown[] {
    return args.map(argument => {
        if (typeof argument === 'string') {
            return redactLogMessage(argument);
        }
        if (argument instanceof Error) {
            return redactError(argument);
        }
        return argument;
    });
}

function redactError(error: Error): Error {
    const redacted = new Error(redactLogMessage(error.message));
    redacted.name = error.name;
    redacted.stack = error.stack ? redactLogMessage(error.stack) : undefined;
    return redacted;
}
