/** Returns a readable message for native errors, RPC errors, and arbitrary thrown values. */
export function getErrorMessage(error: unknown): string {
    return readErrorMessage(error) ?? serializeError(error);
}

/** Includes the error name while keeping native and RPC errors readable. */
export function getErrorSummary(error: unknown): string {
    const message = getErrorMessage(error);
    try {
        if (typeof error === 'object' && error !== null &&
            'name' in error && typeof error.name === 'string' && error.name.length > 0 &&
            error.name !== message) {
            return `${error.name}: ${message}`;
        }
    } catch {
        // Keep the readable message if the error name cannot be inspected.
    }
    return message;
}

/** Preserves RPC fields and nested native-error stacks for diagnostic logs. */
export function formatErrorForLogging(error: unknown): string {
    return serializeError(error);
}

function readErrorMessage(error: unknown): string | undefined {
    try {
        if (typeof error === 'object' && error !== null &&
            'message' in error && typeof error.message === 'string' && error.message.length > 0) {
            return error.message;
        }
        if (error instanceof Error) {
            return error.name || 'Error';
        }
    } catch {
        // A thrown object may contain getters that also throw.
    }
    return undefined;
}

function serializeError(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
        const seen = new WeakSet<object>();
        try {
            const serialized = JSON.stringify(error, (_key, value: unknown) => {
                if (typeof value === 'bigint') {
                    return String(value);
                }
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) {
                        return '[Circular]';
                    }
                    seen.add(value);
                    if (value instanceof Error) {
                        return {
                            name: value.name,
                            message: value.message,
                            code: 'code' in value ? value.code : undefined,
                            data: 'data' in value ? value.data : undefined,
                            details: 'details' in value ? value.details : undefined,
                            errors: 'errors' in value ? value.errors : undefined,
                            exitCode: 'exitCode' in value ? value.exitCode : undefined,
                            stack: value.stack,
                            cause: value.cause,
                        };
                    }
                }
                return value;
            });
            if (serialized !== undefined) {
                return serialized;
            }
        } catch {
            // Error reporting must not hide the original failure if serialization fails.
        }
        return readErrorMessage(error) ?? '[Unserializable error]';
    }
    return String(error);
}
