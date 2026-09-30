import type { ANSIOutputLine, ANSIOutputRun } from '../../lib/ansi/ansiOutput';

export interface ConsoleFileLocation {
    path: string;
    line: number;
    column?: number;
}

export interface ConsoleFileLink extends ConsoleFileLocation {
    start: number;
    end: number;
}

/** Detect locations in visible text, after ANSI processing. Positions are 1-based. */
export function detectFileLinks(text: string): ConsoleFileLink[] {
    const links: ConsoleFileLink[] = [];
    // Require a filename extension and a line number to avoid ordinary prose and ratios.
    // Quoted paths may contain spaces; the unquoted form also supports drive letters/UNC.
    const pattern = /(?:^|[\s("'`\[<{])((?:[A-Za-z]:)?[^\s"'`<>|?:\[\]()]+\.[\p{L}\p{N}_-]+):([1-9]\d*)(?::([1-9]\d*))?(?!\d|:\d)|(["'`])([^\r\n"'`]+\.[\p{L}\p{N}_-]+)\4:([1-9]\d*)(?::([1-9]\d*))?(?!\d|:\d)/gu;
    for (const match of text.matchAll(pattern)) {
        const path = match[1] ?? match[5];
        const line = Number(match[2] ?? match[6]);
        const rawColumn = match[3] ?? match[7];
        const column = rawColumn === undefined ? undefined : Number(rawColumn);
        if (!Number.isSafeInteger(line) || (column !== undefined && !Number.isSafeInteger(column))) {
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
    const text = line.outputRuns.map(run => run.text).join('');
    let offset = 0;
    const ranges = line.outputRuns.map(run => {
        const start = offset;
        offset += run.text.length;
        return { run, start, end: offset };
    });
    const links = detectFileLinks(text).filter(link => !ranges.some(({ run, start, end }) =>
        start < link.end && end > link.start && run.hyperlink &&
        !run.hyperlink.url.startsWith('file:'),
    ));
    if (links.length === 0) {
        return [{ runs: line.outputRuns }];
    }
    const segments: ConsoleOutputSegment[] = [];
    const slice = (start: number, end: number) => ranges
        .filter(range => range.start < end && range.end > start)
        .map(({ run, start: runStart, end: runEnd }) => ({
            ...run,
            // ANSIOutputRun may use prototype getters, so copy its fields explicitly.
            id: `${run.id}:${start}:${end}`,
            text: run.text.slice(Math.max(start - runStart, 0), Math.min(end, runEnd) - runStart),
            format: run.format,
            hyperlink: run.hyperlink,
        }));
    offset = 0;
    for (const link of links) {
        if (offset < link.start) {
            segments.push({ runs: slice(offset, link.start) });
        }
        let path = link.path;
        const explicitLink = ranges.find(({ run, start, end }) =>
            start <= link.start && end >= link.end && run.hyperlink?.url.startsWith('file:'),
        )?.run.hyperlink;
        if (explicitLink) {
            // OSC 8 may display a relative label but carry the exact absolute file URI.
            path = explicitLink.url;
        }
        segments.push({ runs: slice(link.start, link.end), location: {
            path, line: link.line, column: link.column,
        } });
        offset = link.end;
    }
    if (offset < text.length) {
        segments.push({ runs: slice(offset, text.length) });
    }
    return segments;
}
