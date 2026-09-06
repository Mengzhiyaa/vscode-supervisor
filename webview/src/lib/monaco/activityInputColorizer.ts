/**
 * Colorizes console activity input through Monaco's public standalone API.
 *
 * `editor.colorize` preserves tokenization state across lines and delegates to
 * the same renderer used by the standalone editor. Keeping this integration on
 * the public API avoids depending on Monaco's internal services and rendering
 * classes, whose module layout changed in Monaco 0.56.
 */

type MonacoApi = typeof import("monaco-editor/editor");

/**
 * Colorizes plain code lines for activity input history.
 * Returns one HTML fragment per input line, or [] when Monaco returns an
 * unexpected result so the caller can fall back to plain text rendering.
 * Token spans retain the original source characters so DOM selections can be
 * copied without guessing which whitespace was introduced by the renderer.
 */
export async function colorizeActivityInputLines(
    monaco: MonacoApi,
    codeOutputLines: string[],
    languageId: string,
): Promise<string[]> {
    if (codeOutputLines.length === 0) {
        return [];
    }

    const html = await monaco.editor.colorize(
        codeOutputLines.join("\n"),
        languageId,
        // Render each tab as one character so token text offsets still match
        // source UTF-16 offsets. CSS controls the restored tabs' visual width.
        { tabSize: 1 },
    );
    const colorizedLines = html.split(/<br\s*\/?>/iu);

    // Monaco appends a final <br/> after every rendered line.
    if (colorizedLines.at(-1) === "") {
        colorizedLines.pop();
    }

    if (colorizedLines.length !== codeOutputLines.length) {
        return [];
    }

    const template = document.createElement('template');
    const sourceLines: string[] = [];
    for (let index = 0; index < colorizedLines.length; index++) {
        template.innerHTML = colorizedLines[index];
        const source = codeOutputLines[index];

        // Monaco replaces spaces and certain control characters for display.
        // With tabSize 1, each rendered text character has a source counterpart.
        // Fall back if that contract changes or Monaco strips a leading BOM.
        if (template.content.textContent?.length !== source.length) {
            return [];
        }

        const walker = document.createTreeWalker(
            template.content,
            NodeFilter.SHOW_TEXT,
        );
        let offset = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const length = node.textContent?.length ?? 0;
            // Assign text rather than interpolating HTML: source may contain
            // markup, literal NBSPs, narrow NBSPs, tabs or ordinary spaces.
            node.textContent = source.slice(offset, offset + length);
            offset += length;
        }
        sourceLines.push(template.innerHTML);
    }

    return sourceLines;
}
