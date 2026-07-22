export type LocalizedMessageKey = string;

function format(message: string, args: readonly unknown[]): string {
    return message.replace(/\{(\d+)\}/g, (match, rawIndex: string) => {
        const index = Number(rawIndex);
        return index < args.length ? String(args[index]) : match;
    });
}

export function localize(
    key: LocalizedMessageKey,
    defaultValue: string,
    ...args: readonly unknown[]
): string {
    const message = globalThis.__arkLocalization?.[key] ?? defaultValue;
    return format(message, args);
}
