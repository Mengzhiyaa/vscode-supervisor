/**
 * Resolves the user-facing runtime path. Runtime providers can supply a
 * shorter display path (for example `~/bin/R`); otherwise the executable path
 * is shown. Windows separators are normalized for the Console UI only.
 */
export function getRuntimeDisplayPath(
    runtimePath?: string,
    runtimeDisplayPath?: string,
): string {
    return (runtimeDisplayPath || runtimePath || "").replace(/\\/g, "/");
}
