import { describe, expect, it } from "vitest";

import type { DiffLine, PendingLineComment } from "#/lib/session/types.ts";

import {
    buildVirtualRows,
    toSplitRows,
    virtualRowAnchorLineIndex,
    virtualRowIndexForLineIndex,
    type DiffVirtualRow,
} from "#/lib/diff-rows.ts";

const hunk: DiffLine = { kind: "hunk", text: "@@ -1,3 +1,3 @@", oldNumber: null, newNumber: null };

function context(oldNumber: number, newNumber: number): DiffLine {
    return { kind: "context", text: `line ${oldNumber}`, oldNumber, newNumber };
}

function del(oldNumber: number): DiffLine {
    return { kind: "del", text: `old ${oldNumber}`, oldNumber, newNumber: null };
}

function add(newNumber: number): DiffLine {
    return { kind: "add", text: `new ${newNumber}`, oldNumber: null, newNumber };
}

function pending(side: "LEFT" | "RIGHT", line: number): PendingLineComment {
    return { id: `${side}-${line}`, path: "a.ts", side, line, body: "note" } as PendingLineComment;
}

const lines: Array<DiffLine> = [hunk, context(1, 1), del(2), del(3), add(2), context(4, 3), add(4)];

function rows(overrides: Partial<Parameters<typeof buildVirtualRows>[0]> = {}): Array<DiffVirtualRow> {
    return buildVirtualRows({
        lines,
        path: "a.ts",
        layout: "split",
        splitView: "both",
        pendingComments: [],
        threads: [],
        showInlineComments: true,
        compose: null,
        ...overrides,
    });
}

function describeRow(row: DiffVirtualRow): string {
    if (row.kind === "notes") {
        return `notes ${row.notes.side}${row.notes.line}`;
    }
    if (row.kind === "compose") {
        return `compose ${row.target.side}${row.target.line}`;
    }
    if (row.kind === "unified") {
        return row.line.kind;
    }
    if (row.row.kind !== "pair") {
        return row.row.kind;
    }
    return `${row.row.left?.oldNumber ?? "·"}|${row.row.right?.newNumber ?? "·"}`;
}

describe("toSplitRows", () => {
    it("pairs deletions with the additions that follow them", () => {
        expect(
            toSplitRows(lines).map((row) => (row.kind === "pair" ? [row.leftLineIndex, row.rightLineIndex] : row.kind)),
        ).toEqual(["hunk", [1, 1], [2, 4], [3, null], [5, 5], [null, 6]]);
    });

    it("keeps row keys stable when context is revealed above", () => {
        const before = toSplitRows(lines).map((row) => row.key);
        const expanded = toSplitRows([context(0, 0), ...lines]).map((row) => row.key);
        expect(expanded.slice(1)).toEqual(before);
    });
});

describe("buildVirtualRows", () => {
    it("gives every row a unique key in both layouts", () => {
        const comments = [pending("LEFT", 1), pending("RIGHT", 1), pending("LEFT", 2), pending("RIGHT", 2)];
        for (const layout of ["split", "unified"] as const) {
            const keys = rows({ layout, pendingComments: comments }).map((row) => row.key);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });

    it("shows both columns by default", () => {
        expect(rows().map(describeRow)).toEqual(["hunk", "1|1", "2|2", "3|·", "4|3", "·|4"]);
    });

    it("drops added-only rows when only the old version is shown", () => {
        expect(rows({ splitView: "old" }).map(describeRow)).toEqual(["hunk", "1|1", "2|2", "3|·", "4|3"]);
    });

    it("drops deleted-only rows when only the new version is shown", () => {
        expect(rows({ splitView: "new" }).map(describeRow)).toEqual(["hunk", "1|1", "2|2", "4|3", "·|4"]);
    });

    it("hides comments anchored on the hidden version, except on context lines", () => {
        const comments = [pending("LEFT", 1), pending("LEFT", 2), pending("RIGHT", 2)];
        expect(
            rows({ splitView: "new", pendingComments: comments })
                .map(describeRow)
                .filter((row) => row.startsWith("notes")),
        ).toEqual(["notes LEFT1", "notes RIGHT2"]);
    });

    it("places the composer under its line", () => {
        const compose = { path: "a.ts", side: "RIGHT" as const, line: 4, text: "new 4" };
        expect(rows({ compose }).map(describeRow).at(-1)).toBe("compose RIGHT4");
    });
});

describe("virtualRowIndexForLineIndex", () => {
    it("finds the split row that shows a unified line", () => {
        const unified = rows({ layout: "unified" });
        const split = rows();
        const anchor = virtualRowAnchorLineIndex(unified[4]!);
        expect(anchor).toBe(4);
        expect(describeRow(split[virtualRowIndexForLineIndex(split, anchor!)]!)).toBe("2|2");
    });

    it("falls back to the next visible row when the line is hidden", () => {
        const newOnly = rows({ splitView: "new" });
        expect(describeRow(newOnly[virtualRowIndexForLineIndex(newOnly, 3)]!)).toBe("4|3");
    });
});
