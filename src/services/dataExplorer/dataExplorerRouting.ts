/**
 * Data Explorer inline outputs are only renderable inline in notebook-style
 * sessions. In console sessions we fall back to opening the full editor so
 * `View(...)` behaves like the Variables pane.
 */
export function shouldKeepDataExplorerInline(
    sessionMode: string | undefined,
    inlineOnly: boolean
): boolean {
    return inlineOnly && sessionMode === 'notebook';
}
