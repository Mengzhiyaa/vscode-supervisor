/*---------------------------------------------------------------------------------------------
 *  Help utilities
 *--------------------------------------------------------------------------------------------*/

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns True if the hostname represents localhost.
 */
export const isLocalhost = (hostname?: string) =>
    !!(hostname && ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase()));
