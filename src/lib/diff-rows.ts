import type { DiffSearchMatch } from "#/lib/diff-file-search.ts";
import type { DiffLayout, SplitView } from "#/lib/diff-preferences.ts";
import type { DiffLine, DiffSide, PendingLineComment, ReviewThread } from "#/lib/session/types.ts";

export type LineTarget = { path: string; line: number; side: DiffSide; text: string };

export type SplitRow =
    | { key: string; kind: "hunk"; line: DiffLine; lineIndex: number }
    | { key: string; kind: "gap"; line: DiffLine; lineIndex: number }
    | {
          key: string;
          kind: "pair";
          left: DiffLine | null;
          right: DiffLine | null;
          leftLineIndex: number | null;
          rightLineIndex: number | null;
      };

export type LineAnnotations = {
    side: DiffSide;
    line: number;
    text: string;
    pending: Array<PendingLineComment>;
    threads: Array<ReviewThread>;
};

export type DiffVirtualRow =
    | { key: string; kind: "unified"; line: DiffLine; lineIndex: number }
    | { key: string; kind: "split"; row: SplitRow }
    | { key: string; kind: "notes"; notes: LineAnnotations }
    | { key: string; kind: "compose"; target: LineTarget };

type SideLine = { side: DiffSide; line: number };

/**
 * Identity of a code line that survives context expansion: old/new numbers never repeat within
 * one diff, unlike array indexes which shift whenever lines are revealed above.
 */
function lineIdentity(line: DiffLine): string {
    return `${line.oldNumber ?? "x"}:${line.newNumber ?? "x"}`;
}

function markerKey(lines: ReadonlyArray<DiffLine>, index: number): string {
    const line = lines[index]!;
    if (line.kind === "gap" && line.gap) {
        return `gap-${line.gap.id}-${line.gap.oldStart}`;
    }
    // Hunk headers carry no numbers; name them after the first line they introduce.
    const next = lines[index + 1];
    return `${line.kind}-${next ? lineIdentity(next) : "end"}`;
}

export function toSplitRows(lines: ReadonlyArray<DiffLine>): Array<SplitRow> {
    const rows: Array<SplitRow> = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index]!;

        if (line.kind === "hunk" || line.kind === "gap") {
            rows.push({ key: markerKey(lines, index), kind: line.kind, line, lineIndex: index });
            index++;
            continue;
        }

        if (line.kind === "context") {
            rows.push({
                key: `ctx-${lineIdentity(line)}`,
                kind: "pair",
                left: line,
                right: line,
                leftLineIndex: index,
                rightLineIndex: index,
            });
            index++;
            continue;
        }

        const dels: Array<DiffLine> = [];
        const adds: Array<DiffLine> = [];
        const start = index;

        while (index < lines.length && lines[index]!.kind === "del") {
            dels.push(lines[index]!);
            index++;
        }
        const addStart = index;
        while (index < lines.length && lines[index]!.kind === "add") {
            adds.push(lines[index]!);
            index++;
        }

        const count = Math.max(dels.length, adds.length);
        for (let offset = 0; offset < count; offset++) {
            const left = dels[offset] ?? null;
            const right = adds[offset] ?? null;
            rows.push({
                key: `pair-${left?.oldNumber ?? "x"}-${right?.newNumber ?? "x"}`,
                kind: "pair",
                left,
                right,
                leftLineIndex: left ? start + offset : null,
                rightLineIndex: right ? addStart + offset : null,
            });
        }
    }

    return rows;
}

function annotationsForTarget(
    path: string,
    target: SideLine,
    text: string,
    pendingComments: ReadonlyArray<PendingLineComment>,
    threads: ReadonlyArray<ReviewThread>,
): LineAnnotations | null {
    const pending = pendingComments.filter(
        (comment) => comment.path === path && comment.side === target.side && comment.line === target.line,
    );
    const matchedThreads = threads.filter(
        (thread) => thread.path === path && thread.side === target.side && thread.line === target.line,
    );
    if (pending.length === 0 && matchedThreads.length === 0) {
        return null;
    }
    return { side: target.side, line: target.line, text, pending, threads: matchedThreads };
}

function unifiedLineTargets(line: DiffLine): Array<SideLine> {
    if (line.kind === "add") {
        return line.newNumber === null ? [] : [{ side: "RIGHT", line: line.newNumber }];
    }
    if (line.kind === "del") {
        return line.oldNumber === null ? [] : [{ side: "LEFT", line: line.oldNumber }];
    }
    if (line.kind !== "context") {
        return [];
    }
    const targets: Array<SideLine> = [];
    if (line.oldNumber !== null) {
        targets.push({ side: "LEFT", line: line.oldNumber });
    }
    if (line.newNumber !== null) {
        targets.push({ side: "RIGHT", line: line.newNumber });
    }
    return targets;
}

/**
 * Comment anchors a split row exposes. A one-sided view drops the hidden column, except on context
 * lines: they exist in both versions, so their comments stay visible either way.
 */
function splitRowTargets(row: Extract<SplitRow, { kind: "pair" }>, splitView: SplitView): Array<SideLine> {
    const targets: Array<SideLine> = [];
    if (row.left?.oldNumber != null && (splitView !== "new" || row.left.kind === "context")) {
        targets.push({ side: "LEFT", line: row.left.oldNumber });
    }
    if (row.right?.newNumber != null && (splitView !== "old" || row.right.kind === "context")) {
        targets.push({ side: "RIGHT", line: row.right.newNumber });
    }
    return targets;
}

function isSplitRowVisible(row: SplitRow, splitView: SplitView): boolean {
    if (row.kind !== "pair") {
        return true;
    }
    if (splitView === "old") {
        return row.left !== null;
    }
    if (splitView === "new") {
        return row.right !== null;
    }
    return true;
}

/** Flattens a diff into virtualizer rows: code lines, then their comment threads and composer. */
export function buildVirtualRows({
    lines,
    path,
    layout,
    splitView,
    pendingComments,
    threads,
    showInlineComments,
    compose,
}: {
    lines: ReadonlyArray<DiffLine>;
    path: string;
    layout: DiffLayout;
    splitView: SplitView;
    pendingComments: ReadonlyArray<PendingLineComment>;
    threads: ReadonlyArray<ReviewThread>;
    showInlineComments: boolean;
    compose: LineTarget | null;
}): Array<DiffVirtualRow> {
    const rows: Array<DiffVirtualRow> = [];

    function pushAnnotations(targets: ReadonlyArray<SideLine>, textFor: (target: SideLine) => string) {
        if (showInlineComments) {
            for (const target of targets) {
                const notes = annotationsForTarget(path, target, textFor(target), pendingComments, threads);
                if (notes) {
                    rows.push({ key: `notes-${target.side}-${target.line}`, kind: "notes", notes });
                }
            }
        }
        if (compose && targets.some((target) => target.side === compose.side && target.line === compose.line)) {
            rows.push({ key: `compose-${compose.side}-${compose.line}`, kind: "compose", target: compose });
        }
    }

    if (layout === "split") {
        for (const row of toSplitRows(lines)) {
            if (!isSplitRowVisible(row, splitView)) {
                continue;
            }
            rows.push({ key: `split-${row.key}`, kind: "split", row });
            if (row.kind !== "pair") {
                continue;
            }
            pushAnnotations(splitRowTargets(row, splitView), (target) =>
                target.side === "LEFT" ? (row.left?.text ?? "") : (row.right?.text ?? ""),
            );
        }
        return rows;
    }

    for (const [index, line] of lines.entries()) {
        const key = line.kind === "hunk" || line.kind === "gap" ? markerKey(lines, index) : lineIdentity(line);
        rows.push({ key: `line-${key}`, kind: "unified", line, lineIndex: index });
        pushAnnotations(unifiedLineTargets(line), () => line.text ?? "");
    }

    return rows;
}

/** Indexes into the diff's `lines` that one virtual row renders (none for comment rows). */
function virtualRowLineIndices(row: DiffVirtualRow): Array<number> {
    if (row.kind === "unified") {
        return [row.lineIndex];
    }
    if (row.kind !== "split") {
        return [];
    }
    if (row.row.kind !== "pair") {
        return [row.row.lineIndex];
    }
    return [row.row.leftLineIndex, row.row.rightLineIndex].filter((value): value is number => value !== null);
}

/** First diff line a row shows, used to keep the reader's place when the layout changes. */
export function virtualRowAnchorLineIndex(row: DiffVirtualRow): number | null {
    const indices = virtualRowLineIndices(row);
    return indices.length === 0 ? null : Math.min(...indices);
}

/** Row showing `lineIndex`, or the next row after it when that line is hidden in this view. */
export function virtualRowIndexForLineIndex(rows: ReadonlyArray<DiffVirtualRow>, lineIndex: number): number {
    let fallback = -1;
    for (const [index, row] of rows.entries()) {
        const indices = virtualRowLineIndices(row);
        if (indices.includes(lineIndex)) {
            return index;
        }
        if (fallback === -1 && indices.length > 0 && Math.min(...indices) > lineIndex) {
            fallback = index;
        }
    }
    return fallback;
}

export function virtualRowIndexForMatch(rows: ReadonlyArray<DiffVirtualRow>, match: DiffSearchMatch): number {
    for (const [index, row] of rows.entries()) {
        if (row.kind === "unified" && row.lineIndex === match.lineIndex && match.side === "unified") {
            return index;
        }
        if (row.kind !== "split" || row.row.kind !== "pair") {
            continue;
        }
        if ((match.side === "both" || match.side === "LEFT") && row.row.leftLineIndex === match.lineIndex) {
            return index;
        }
        if ((match.side === "both" || match.side === "RIGHT") && row.row.rightLineIndex === match.lineIndex) {
            return index;
        }
    }
    return -1;
}
