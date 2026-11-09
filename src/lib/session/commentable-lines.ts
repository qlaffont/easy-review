import type { CommentableLines, DiffSide } from "#/lib/session/types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/** Read the commentable line ranges out of a unified patch's `@@ -a,b +c,d @@` headers. */
export function parseCommentableLines(patch: string): CommentableLines {
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];

    for (const match of patch.matchAll(HUNK_HEADER)) {
        const oldStart = Number(match[1]);
        const oldCount = match[2] === undefined ? 1 : Number(match[2]);
        const newStart = Number(match[3]);
        const newCount = match[4] === undefined ? 1 : Number(match[4]);

        if (oldCount > 0) {
            left.push([oldStart, oldStart + oldCount - 1]);
        }
        if (newCount > 0) {
            right.push([newStart, newStart + newCount - 1]);
        }
    }

    return { left, right };
}

/** Whether GitHub will accept a review comment on this line. Unknown ranges allow every line. */
export function isCommentableLine(lines: CommentableLines | undefined, side: DiffSide, line: number): boolean {
    if (!lines) {
        return true;
    }

    const ranges = side === "LEFT" ? lines.left : lines.right;
    return ranges.some(([start, end]) => line >= start && line <= end);
}
