import type { ANSIHyperlink, ANSIOutputLine, ANSIOutputRun } from '../../lib/ansi/ansiOutput';

export interface ConsoleFileLocation {
    path: string;
    line: number;
    column?: number;
}

export interface ConsoleFileLink extends ConsoleFileLocation {
    start: number;
    end: number;
}

/** Resolve OSC 8 file positions using Positron's parameter/URL precedence. */
export function resolveAnsiFileLink(hyperlink: ANSIHyperlink): ConsoleFileLocation | undefined {
    if (!/^file:/i.test(hyperlink.url)) {
        return undefined;
    }
    const positiveInteger = (value: string | undefined): number | undefined => {
        if (!value || !/^\d+$/.test(value)) {
            return undefined;
        }
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : undefined;
    };
    try {
        // cli versions can emit file://C:\path in Windows sessions.
        const url = new URL(
            hyperlink.url.replace(/\\/g, '/').replace(/^(file:\/\/)([a-z]:)/i, '$1/$2'),
        );
        let line = positiveInteger(hyperlink.params?.get('line'));
        let column = line ? positiveInteger(hyperlink.params?.get('col')) : undefined;
        if (!line && !hyperlink.params?.get('line')) {
            const fragment = url.hash.match(/^#(\d+)(?:,(\d+))?$/);
            const suffix =
                url.pathname.match(/^(.*):(\d+):(\d+)$/) ?? url.pathname.match(/^(.*):(\d+)$/);
            if (fragment) {
                line = positiveInteger(fragment[1]);
                column = positiveInteger(fragment[2]);
            } else if (suffix) {
                line = positiveInteger(suffix[2]);
                column = positiveInteger(suffix[3]);
                if (line) {
                    url.pathname = suffix[1];
                }
            }
        }
        url.hash = '';
        return { path: url.toString(), line: line ?? 1, column };
    } catch {
        return undefined;
    }
}

/** Detect locations in visible text, after ANSI processing. Positions are 1-based. */
export function detectFileLinks(text: string): ConsoleFileLink[] {
    const links: ConsoleFileLink[] = [];
    // Require a filename extension and a line number to avoid ordinary prose and ratios.
    // Quoted paths may contain spaces; the unquoted form also supports drive letters/UNC.
    const pattern =
        /(?:^|[\s("'`\[<{])((?:[A-Za-z]:)?[^\s"'`<>|?:\[\]()]+\.[\p{L}\p{N}_-]+):([1-9]\d*)(?::([1-9]\d*))?(?!\d|:\d)|(["'`])([^\r\n"'`]+\.[\p{L}\p{N}_-]+)\4:([1-9]\d*)(?::([1-9]\d*))?(?!\d|:\d)/gu;
    for (const match of text.matchAll(pattern)) {
        const path = match[1] ?? match[5];
        const line = Number(match[2] ?? match[6]);
        const rawColumn = match[3] ?? match[7];
        const column = rawColumn === undefined ? undefined : Number(rawColumn);
        if (
            !Number.isSafeInteger(line) ||
            (column !== undefined && !Number.isSafeInteger(column))
        ) {
            continue;
        }
        const start = match.index! + (match[1] ? match[0].indexOf(path) : 0);
        links.push({ path, line, column, start, end: match.index! + match[0].length });
    }
    return links;
}

export interface ConsoleOutputSegment {
    runs: readonly ANSIOutputRun[];
    location?: ConsoleFileLocation;
}

/** Project whole-line matches back onto the original styles, including split ANSI runs. */
export function splitOutputLine(line: ANSIOutputLine): ConsoleOutputSegment[] {
    const text = line.outputRuns.map((run) => run.text).join('');
    let offset = 0;
    const ranges = line.outputRuns.map((run) => {
        const start = offset;
        offset += run.text.length;
        return { run, start, end: offset };
    });
    const links = detectFileLinks(text).filter(
        (link) =>
            !ranges.some(
                ({ run, start, end }) => start < link.end && end > link.start && run.hyperlink,
            ),
    );
    if (links.length === 0) {
        return [{ runs: line.outputRuns }];
    }
    const segments: ConsoleOutputSegment[] = [];
    const slice = (start: number, end: number) =>
        ranges
            .filter((range) => range.start < end && range.end > start)
            .map(({ run, start: runStart, end: runEnd }) => ({
                ...run,
                // ANSIOutputRun may use prototype getters, so copy its fields explicitly.
                id: `${run.id}:${start}:${end}`,
                text: run.text.slice(
                    Math.max(start - runStart, 0),
                    Math.min(end, runEnd) - runStart,
                ),
                format: run.format,
                hyperlink: run.hyperlink,
            }));
    offset = 0;
    for (const link of links) {
        if (offset < link.start) {
            segments.push({ runs: slice(offset, link.start) });
        }
        segments.push({
            runs: slice(link.start, link.end),
            location: {
                path: link.path,
                line: link.line,
                column: link.column,
            },
        });
        offset = link.end;
    }
    if (offset < text.length) {
        segments.push({ runs: slice(offset, text.length) });
    }
    return segments;
}
