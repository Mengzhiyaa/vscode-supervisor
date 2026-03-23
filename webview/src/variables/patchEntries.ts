/**
 * patchEntries – stable-reference entry patching for the Variables webview.
 *
 * When new entries arrive from the Extension Host they are plain objects
 * serialised over JSON-RPC, so every entry is a *new* reference even when
 * nothing has changed.  Svelte's keyed {#each} still re-renders a component
 * when its prop reference changes.
 *
 * This module compares incoming entries against the previous array by `id`
 * and reuses the old object when all visible fields are identical.
 * The result is that unchanged rows keep a stable JS reference so Svelte
 * can skip their update entirely.
 */

import type {
    VariableEntry,
    IVariableGroup,
    IVariableItem,
    IVariableOverflow,
} from "../types/variables";

import {
    isVariableGroup,
    isVariableItem,
    isVariableOverflow,
} from "../types/variables";

export interface PatchResult {
    /** The patched array – unchanged entries reuse the old reference. */
    entries: VariableEntry[];
    /** Whether *any* entry is structurally different from before. */
    changed: boolean;
}

/**
 * Patch `incoming` against `existing`, reusing old entry objects when
 * their content hasn't changed.
 *
 * Uses a `Map<id, entry>` lookup so insertions, deletions and
 * reordering are all handled correctly.
 */
export function patchEntries(
    existing: VariableEntry[],
    incoming: VariableEntry[],
): PatchResult {
    if (existing.length === 0) {
        return { entries: incoming, changed: incoming.length > 0 };
    }

    const oldMap = new Map<string, VariableEntry>();
    for (const e of existing) {
        oldMap.set(e.id, e);
    }

    let changed = existing.length !== incoming.length;
    const result: VariableEntry[] = new Array(incoming.length);

    for (let i = 0; i < incoming.length; i++) {
        const inc = incoming[i];
        const old = oldMap.get(inc.id);
        if (old && entriesEqual(old, inc)) {
            result[i] = old;
            // Detect reorder: even if content is identical, a different id
            // at this position means the array order changed.
            if (!changed && (i >= existing.length || existing[i].id !== inc.id)) {
                changed = true;
            }
        } else {
            result[i] = inc;
            changed = true;
        }
    }

    return { entries: result, changed };
}

/**
 * Shallow-compare two entries of the same type.
 * Only fields that affect rendering are compared.
 */
export function entriesEqual(
    a: VariableEntry,
    b: VariableEntry,
): boolean {
    if (a.type !== b.type) {
        return false;
    }

    if (isVariableGroup(a) && isVariableGroup(b)) {
        return groupsEqual(a, b);
    }

    if (isVariableItem(a) && isVariableItem(b)) {
        return itemsEqual(a, b);
    }

    if (isVariableOverflow(a) && isVariableOverflow(b)) {
        return overflowsEqual(a, b);
    }

    return false;
}

function groupsEqual(a: IVariableGroup, b: IVariableGroup): boolean {
    return a.title === b.title && a.isExpanded === b.isExpanded;
}

function itemsEqual(a: IVariableItem, b: IVariableItem): boolean {
    return (
        a.displayName === b.displayName &&
        a.displayValue === b.displayValue &&
        a.displayType === b.displayType &&
        a.size === b.size &&
        a.kind === b.kind &&
        a.hasChildren === b.hasChildren &&
        a.hasViewer === b.hasViewer &&
        a.isExpanded === b.isExpanded &&
        a.indentLevel === b.indentLevel &&
        a.isRecent === b.isRecent
    );
}

function overflowsEqual(a: IVariableOverflow, b: IVariableOverflow): boolean {
    return (
        a.overflowValues === b.overflowValues &&
        a.indentLevel === b.indentLevel
    );
}
