/** A browser input model's identity and monotonic version; never persisted. */
export interface ConsoleInputDraft {
    clientId: string;
    version: number;
    code: string;
}

export interface ConsoleInputEdit {
    code?: string;
    expectedDraft?: ConsoleInputDraft;
}

/** Preserve edits and type-ahead made after the host captured the draft. */
export function reconcileConsoleInputEdit(
    current: ConsoleInputDraft,
    edit: ConsoleInputEdit,
): string {
    const expected = edit.expectedDraft;
    const replacement = edit.code ?? '';
    if (!expected) {
        // Legacy/unmounted inputs may accept a restore only while empty.
        return current.code ? current.code : replacement;
    }
    if (current.clientId !== expected.clientId) {
        return current.code;
    }
    if (current.version === expected.version && current.code === expected.code) {
        return replacement;
    }
    if (current.code.startsWith(expected.code)) {
        const tail = current.code.slice(expected.code.length);
        return replacement && tail ? `${replacement}\n${tail}` : replacement + tail;
    }
    return current.code;
}
