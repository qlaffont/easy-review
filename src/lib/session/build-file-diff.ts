import { diffLines } from "diff";

import type { DiffLine, FileDiff, FileStubReason } from "#/lib/session/types.ts";

import { MAX_RENDERED_DIFF_LINES, stubForBlob } from "#/lib/session/diff-policy.ts";

export type FileSides = {
    path: string;
    /** Missing when the file was added. */
    before: Uint8Array | null;
    /** Missing when the file was removed. */
    after: Uint8Array | null;
};

export type DiffMaterializeOptions = {
    ignoreWhitespace?: boolean;
    /** Show every line of both sides (no collapsed gaps). */
    showFullFile?: boolean;
    /** Context lines kept around each change when not showing the full file. */
    contextLines?: number;
    /**
     * Per unchanged-region id, how many lines have been revealed from the start / end of that
     * region (GitHub-style expand). `all` reveals the whole region.
     */
    expansions?: Record<string, { fromStart?: number; fromEnd?: number; all?: boolean }>;
};

export const DEFAULT_DIFF_CONTEXT_LINES = 3;
export const DIFF_EXPAND_CHUNK = 20;

type AlignedRow =
    | { type: "equal"; oldNumber: number; newNumber: number; text: string }
    | { type: "del"; oldNumber: number; text: string }
    | { type: "add"; newNumber: number; text: string };

function decodeText(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function splitLines(text: string): Array<string> {
    if (text.length === 0) {
        return [];
    }

    const parts = text.split("\n");
    return text.endsWith("\n") ? parts.slice(0, -1) : parts;
}

/**
 * Turn the two sides of a change into numbered diff lines. Binary / huge decisions happen here
 * so every adapter (HTTP, fake) shares one policy.
 */
export function buildFileDiff(sides: FileSides, { force = false }: { force?: boolean } = {}): FileDiff {
    for (const side of [sides.after, sides.before]) {
        if (!side) {
            continue;
        }

        const stub = stubForBlob(side, force);

        if (stub) {
            return emptyDiff(sides.path, stub);
        }
    }

    const beforeText = sides.before ? decodeText(sides.before) : "";
    const afterText = sides.after ? decodeText(sides.after) : "";

    return materializeFileDiff(sides.path, beforeText, afterText);
}

export function materializeFileDiff(
    path: string,
    beforeText: string,
    afterText: string,
    options: DiffMaterializeOptions = {},
): FileDiff {
    const lines = toDiffLines(beforeText, afterText, options);
    const truncated = lines.length > MAX_RENDERED_DIFF_LINES;

    return {
        path,
        lines: truncated ? lines.slice(0, MAX_RENDERED_DIFF_LINES) : lines,
        truncated,
        stub: null,
        beforeText,
        afterText,
    };
}

function emptyDiff(path: string, stub: FileStubReason | null): FileDiff {
    return { path, lines: [], truncated: false, stub, beforeText: null, afterText: null };
}

function alignRows(before: string, after: string, ignoreWhitespace: boolean): Array<AlignedRow> {
    const changes = diffLines(before, after, { ignoreWhitespace });
    const rows: Array<AlignedRow> = [];
    let oldNumber = 1;
    let newNumber = 1;

    for (const change of changes) {
        const chunk = splitLines(change.value);

        if (change.added) {
            for (const text of chunk) {
                rows.push({ type: "add", newNumber: newNumber++, text });
            }
            continue;
        }

        if (change.removed) {
            for (const text of chunk) {
                rows.push({ type: "del", oldNumber: oldNumber++, text });
            }
            continue;
        }

        for (const text of chunk) {
            rows.push({ type: "equal", oldNumber: oldNumber++, newNumber: newNumber++, text });
        }
    }

    return rows;
}

function gapId(oldStart: number, oldEnd: number, newStart: number, newEnd: number): string {
    return `${oldStart}-${oldEnd}:${newStart}-${newEnd}`;
}

function toDiffLines(before: string, after: string, options: DiffMaterializeOptions): Array<DiffLine> {
    const contextLines = options.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES;
    const rows = alignRows(before, after, options.ignoreWhitespace ?? false);

    if (rows.length === 0) {
        return [];
    }

    if (options.showFullFile) {
        return emitVisible(rows, new Set(rows.map((_, index) => index)));
    }

    const visible = new Set<number>();

    for (let index = 0; index < rows.length; index++) {
        if (rows[index]!.type !== "equal") {
            visible.add(index);
        }
    }

    // Context around each change.
    for (let index = 0; index < rows.length; index++) {
        if (rows[index]!.type === "equal") {
            continue;
        }

        for (let offset = 1; offset <= contextLines; offset++) {
            if (index - offset >= 0 && rows[index - offset]!.type === "equal") {
                visible.add(index - offset);
            }
            if (index + offset < rows.length && rows[index + offset]!.type === "equal") {
                visible.add(index + offset);
            }
        }
    }

    // Apply per-gap expansions against original equal runs.
    for (const run of equalRuns(rows)) {
        const id = gapId(run.oldStart, run.oldEnd, run.newStart, run.newEnd);
        const expansion = options.expansions?.[id];
        if (!expansion) {
            continue;
        }

        if (expansion.all) {
            for (let index = run.startIndex; index <= run.endIndex; index++) {
                visible.add(index);
            }
            continue;
        }

        const fromStart = expansion.fromStart ?? 0;
        const fromEnd = expansion.fromEnd ?? 0;

        for (let offset = 0; offset < fromStart; offset++) {
            const index = run.startIndex + offset;
            if (index <= run.endIndex) {
                visible.add(index);
            }
        }

        for (let offset = 0; offset < fromEnd; offset++) {
            const index = run.endIndex - offset;
            if (index >= run.startIndex) {
                visible.add(index);
            }
        }
    }

    // If there are no changes (whitespace-only hide, identical files), show a short head preview.
    if (visible.size === 0) {
        for (let index = 0; index < Math.min(rows.length, contextLines * 2); index++) {
            visible.add(index);
        }
    }

    return emitVisible(rows, visible);
}

type EqualRun = {
    startIndex: number;
    endIndex: number;
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
};

function equalRuns(rows: Array<AlignedRow>): Array<EqualRun> {
    const runs: Array<EqualRun> = [];
    let index = 0;

    while (index < rows.length) {
        const row = rows[index]!;
        if (row.type !== "equal") {
            index++;
            continue;
        }

        const startIndex = index;
        const oldStart = row.oldNumber;
        const newStart = row.newNumber;
        let endIndex = index;
        let oldEnd = row.oldNumber;
        let newEnd = row.newNumber;

        while (endIndex + 1 < rows.length && rows[endIndex + 1]!.type === "equal") {
            endIndex++;
            const next = rows[endIndex] as Extract<AlignedRow, { type: "equal" }>;
            oldEnd = next.oldNumber;
            newEnd = next.newNumber;
        }

        runs.push({ startIndex, endIndex, oldStart, oldEnd, newStart, newEnd });
        index = endIndex + 1;
    }

    return runs;
}

function emitVisible(rows: Array<AlignedRow>, visible: Set<number>): Array<DiffLine> {
    const lines: Array<DiffLine> = [];
    let index = 0;

    while (index < rows.length) {
        if (!visible.has(index)) {
            // Collapse a hidden equal run into a gap row (only equals are ever hidden).
            const runStart = index;
            while (index < rows.length && !visible.has(index)) {
                index++;
            }
            const runEnd = index - 1;
            const first = rows[runStart] as Extract<AlignedRow, { type: "equal" }>;
            const last = rows[runEnd] as Extract<AlignedRow, { type: "equal" }>;
            // Gap id uses the full original equal run bounds (may extend past this remaining hole).
            const full = enclosingEqualRun(rows, runStart);
            const atStart = runStart === 0;
            const atEnd = runEnd === rows.length - 1;
            lines.push({
                kind: "gap",
                text: "",
                oldNumber: null,
                newNumber: null,
                gap: {
                    id: gapId(full.oldStart, full.oldEnd, full.newStart, full.newEnd),
                    oldStart: first.oldNumber,
                    oldEnd: last.oldNumber,
                    newStart: first.newNumber,
                    newEnd: last.newNumber,
                    // Top-of-file hole: only expand toward the hunk below. Bottom: only toward above.
                    // Entire-file hole: allow both directions.
                    expandDown: !atStart || atEnd,
                    expandUp: !atEnd || atStart,
                },
            });
            continue;
        }

        // Emit a hunk: contiguous visible rows that include at least one change, with a header.
        const blockStart = index;
        while (index < rows.length && visible.has(index)) {
            index++;
        }
        const block = rows.slice(blockStart, index);
        const hasChange = block.some((row) => row.type !== "equal");

        if (hasChange) {
            lines.push(hunkHeader(block));
        }

        for (const row of block) {
            lines.push(rowToDiffLine(row));
        }
    }

    return lines;
}

function enclosingEqualRun(rows: Array<AlignedRow>, indexInRun: number): EqualRun {
    const runs = equalRuns(rows);
    const match = runs.find((run) => indexInRun >= run.startIndex && indexInRun <= run.endIndex);
    if (match) {
        return match;
    }

    const row = rows[indexInRun] as Extract<AlignedRow, { type: "equal" }>;
    return {
        startIndex: indexInRun,
        endIndex: indexInRun,
        oldStart: row.oldNumber,
        oldEnd: row.oldNumber,
        newStart: row.newNumber,
        newEnd: row.newNumber,
    };
}

function hunkHeader(block: Array<AlignedRow>): DiffLine {
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;

    for (const row of block) {
        if (row.type === "equal" || row.type === "del") {
            if (oldCount === 0) {
                oldStart = row.oldNumber;
            }
            oldCount++;
        }
        if (row.type === "equal" || row.type === "add") {
            if (newCount === 0) {
                newStart = row.newNumber;
            }
            newCount++;
        }
    }

    // Pure additions / deletions still need a sensible @@ header.
    if (oldCount === 0) {
        oldStart = 0;
    }
    if (newCount === 0) {
        newStart = 0;
    }

    return {
        kind: "hunk",
        text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        oldNumber: null,
        newNumber: null,
    };
}

function rowToDiffLine(row: AlignedRow): DiffLine {
    switch (row.type) {
        case "equal":
            return {
                kind: "context",
                text: row.text,
                oldNumber: row.oldNumber,
                newNumber: row.newNumber,
            };
        case "del":
            return { kind: "del", text: row.text, oldNumber: row.oldNumber, newNumber: null };
        case "add":
            return { kind: "add", text: row.text, oldNumber: null, newNumber: row.newNumber };
    }
}

/** Grow a gap expansion; returns the next expansions map. */
export function expandDiffGap(
    expansions: Record<string, { fromStart?: number; fromEnd?: number; all?: boolean }>,
    gapIdValue: string,
    direction: "up" | "down" | "all",
    chunk = DIFF_EXPAND_CHUNK,
): Record<string, { fromStart?: number; fromEnd?: number; all?: boolean }> {
    if (direction === "all") {
        return { ...expansions, [gapIdValue]: { all: true } };
    }

    const current = expansions[gapIdValue] ?? {};
    if (current.all) {
        return expansions;
    }

    if (direction === "down") {
        return {
            ...expansions,
            [gapIdValue]: { ...current, fromStart: (current.fromStart ?? 0) + chunk },
        };
    }

    return {
        ...expansions,
        [gapIdValue]: { ...current, fromEnd: (current.fromEnd ?? 0) + chunk },
    };
}
