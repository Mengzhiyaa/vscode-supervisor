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
        { tabSize: 4 },
    );
    const colorizedLines = html.split(/<br\s*\/?>/iu);

    // Monaco appends a final <br/> after every rendered line.
    if (colorizedLines.at(-1) === "") {
        colorizedLines.pop();
    }

    return colorizedLines.length === codeOutputLines.length
        ? colorizedLines
        : [];
}
