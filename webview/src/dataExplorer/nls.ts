/*---------------------------------------------------------------------------------------------
 *  NLS (National Language Support) - Lightweight localization for webview
 *  Matches Positron's localize() API signature for compatibility
 *--------------------------------------------------------------------------------------------*/

/**
 * Marks a string to be localized. Returns the localized string.
 *
 * In a webview context, this simply returns the default message with
 * argument substitution. When a full NLS infrastructure is available,
 * this can be extended to look up translations by key.
 *
 * @param key The key to use for localizing the string
 * @param message The string to localize (default/fallback message)
 * @param args The arguments to substitute in the string
 *
 * @note `message` can contain `{n}` notation where it is replaced by the nth value in `...args`
 * @example `localize('positron.sayHello', 'hello {0}', name)`
 *
 * @returns The localized string
 */
export function localize(
    _key: string,
    message: string,
    ...args: (string | number | boolean | undefined | null)[]
): string {
    if (args.length === 0) {
        return message;
    }

    return message.replace(/\{(\d+)\}/g, (match, rest) => {
        const index = rest[0];
        const arg = args[index];
        if (typeof arg === 'string') {
            return arg;
        } else if (
            typeof arg === 'number' ||
            typeof arg === 'boolean' ||
            arg === void 0 ||
            arg === null
        ) {
            return String(arg);
        }
        return match;
    });
}
