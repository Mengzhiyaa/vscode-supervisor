/*---------------------------------------------------------------------------------------------
 *  Console Search Utilities
 *  Provides search options, match finding, and DOM highlight functionality
 *  using the CSS Custom Highlight API.
 *--------------------------------------------------------------------------------------------*/

/**
 * Options for controlling console search behavior.
 */
export interface SearchOptions {
    caseSensitive: boolean;
    useRegex: boolean;
    wholeWord: boolean;
}

/**
 * Represents a single search match with its position within the container.
 */
export interface SearchMatch {
    /** The DOM Range covering this match */
    range: Range;
    /** Index of this match in the full results list */
    index: number;
}

/**
 * Default search options.
 */
export const defaultSearchOptions: SearchOptions = {
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
};

/**
 * Builds a RegExp from the query string and search options.
 * Returns null if the query is invalid.
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
    if (!query) {
        return null;
    }

    let pattern: string;
    if (options.useRegex) {
        // Validate regex
        try {
            new RegExp(query);
            pattern = query;
        } catch {
            return null;
        }
    } else {
        // Escape special regex characters for literal search
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (options.wholeWord) {
        pattern = `\\b${pattern}\\b`;
    }

    const flags = options.caseSensitive ? 'g' : 'gi';

    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

/**
 * Returns the nearest block-level ancestor element of a node.
 * Used to detect visual line boundaries in the DOM.
 */
function getBlockAncestor(node: Node): Element | null {
    const blockTags = new Set(['DIV', 'P', 'PRE', 'LI', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'TR']);
    let el = node.parentElement;
    while (el) {
        if (blockTags.has(el.tagName)) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
}

/**
 * Finds all text matches within a container element using TreeWalker,
 * and returns SearchMatch objects with DOM Ranges.
 *
 * Inserts virtual newline characters between text from different block-level
 * elements so that regex `.` won't match across visual lines (consistent
 * with VS Code's search behavior).
 */
export function findMatchesInDOM(
    container: HTMLElement,
    regex: RegExp,
): SearchMatch[] {
    const matches: SearchMatch[] = [];

    // Collect all text nodes in order
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null,
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.length > 0) {
            textNodes.push(node);
        }
    }

    if (textNodes.length === 0) {
        return matches;
    }

    // Build a mapping of character offsets to text nodes.
    // Insert \n between text nodes from different block-level parents
    // so that regex . won't match across visual lines.
    interface TextNodeInfo {
        node: Text;
        start: number; // Start offset in the concatenated string
        end: number;   // End offset in the concatenated string
    }

    const nodeInfos: TextNodeInfo[] = [];
    let fullText = '';
    let prevBlockParent: Element | null = null;

    for (const textNode of textNodes) {
        const blockParent = getBlockAncestor(textNode);

        // Insert newline at block element boundaries
        if (prevBlockParent !== null && blockParent !== prevBlockParent) {
            fullText += '\n';
        }
        prevBlockParent = blockParent;

        const start = fullText.length;
        fullText += textNode.textContent!;
        nodeInfos.push({
            node: textNode,
            start,
            end: fullText.length,
        });
    }

    // Reset regex lastIndex for fresh search
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    let matchIndex = 0;

    let startNodeInfoIndex = 0;
    let endNodeInfoIndex = 0;

    while ((match = regex.exec(fullText)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;

        // Prevent infinite loops with zero-length matches
        if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
        }

        // Find the text nodes that contain the start and end of this match
        while (
            startNodeInfoIndex < nodeInfos.length &&
            matchStart >= nodeInfos[startNodeInfoIndex].end
        ) {
            startNodeInfoIndex += 1;
        }
        while (
            endNodeInfoIndex < nodeInfos.length &&
            matchEnd > nodeInfos[endNodeInfoIndex].end
        ) {
            endNodeInfoIndex += 1;
        }

        const startNodeInfo = nodeInfos[startNodeInfoIndex];
        const endNodeInfo = nodeInfos[endNodeInfoIndex];

        if (
            startNodeInfo &&
            endNodeInfo &&
            matchStart >= startNodeInfo.start &&
            matchStart < startNodeInfo.end &&
            matchEnd > endNodeInfo.start &&
            matchEnd <= endNodeInfo.end
        ) {
            try {
                const range = document.createRange();
                range.setStart(
                    startNodeInfo.node,
                    matchStart - startNodeInfo.start,
                );
                range.setEnd(
                    endNodeInfo.node,
                    matchEnd - endNodeInfo.start,
                );

                matches.push({
                    range,
                    index: matchIndex++,
                });
            } catch {
                // Skip invalid ranges
            }
        }
    }

    return matches;
}

/**
 * Applies search highlights using the CSS Custom Highlight API.
 * Creates two highlight groups:
 *   - 'console-search-matches': all matches (yellow background)
 *   - 'console-search-current': the current/active match (orange background)
 */
export function applyHighlights(
    matches: SearchMatch[],
    currentIndex: number,
): void {
    // Clear existing highlights
    clearHighlights();

    if (matches.length === 0) {
        return;
    }

    // Separate the current match from all matches
    const allRanges: Range[] = [];
    let currentRange: Range | null = null;

    for (const match of matches) {
        allRanges.push(match.range);
        if (match.index === currentIndex) {
            currentRange = match.range;
        }
    }

    // Apply all-matches highlight
    try {
        const allHighlight = new Highlight(...allRanges);
        CSS.highlights.set('console-search-matches', allHighlight);

        // Apply current-match highlight
        if (currentRange) {
            const currentHighlight = new Highlight(currentRange);
            CSS.highlights.set('console-search-current', currentHighlight);
        }
    } catch {
        // CSS Custom Highlight API not supported - silently fail
        console.warn('CSS Custom Highlight API not supported');
    }
}

/**
 * Clears all search highlights.
 */
export function clearHighlights(): void {
    try {
        CSS.highlights.delete('console-search-matches');
        CSS.highlights.delete('console-search-current');
    } catch {
        // CSS Custom Highlight API not supported
    }
}

/**
 * Scrolls the currently highlighted match into view.
 */
export function scrollCurrentMatchIntoView(
    matches: SearchMatch[],
    currentIndex: number,
): void {
    if (currentIndex < 0 || currentIndex >= matches.length) {
        return;
    }

    const match = matches[currentIndex];
    const rect = match.range.getBoundingClientRect();

    // Find the scrollable console-instance container
    const container = match.range.startContainer.parentElement?.closest(
        '.console-instance',
    );

    if (!container) {
        return;
    }

    const containerRect = container.getBoundingClientRect();

    // Check if the match is outside the visible area
    if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
        // Scroll the range into view
        const element = match.range.startContainer.parentElement;
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}
