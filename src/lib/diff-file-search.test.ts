import { describe, expect, it } from "vitest";

import type { DiffLine } from "#/lib/session/types.ts";

import { collectDiffSearchMatches, findTextRanges, withSearchHighlights } from "#/lib/diff-file-search.ts";

describe("findTextRanges", () => {
    it("finds case-insensitive matches", () => {
        expect(findTextRanges("Hello WORLD world", "world")).toEqual([
            { start: 6, end: 11 },
            { start: 12, end: 17 },
        ]);
    });
});

describe("collectDiffSearchMatches", () => {
    const lines: Array<DiffLine> = [
        { kind: "context", text: "const value = 1;", oldNumber: 1, newNumber: 1 },
        { kind: "add", text: "const next = value + 1;", oldNumber: null, newNumber: 2 },
    ];

    it("collects unified matches by line index", () => {
        const matches = collectDiffSearchMatches(lines, "value", "unified");
        expect(matches).toHaveLength(2);
        expect(matches[0]).toMatchObject({ lineIndex: 0, side: "unified", start: 6, end: 11 });
    });
});

describe("withSearchHighlights", () => {
    it("splits syntax segments at search boundaries", () => {
        const segments = withSearchHighlights(
            [{ value: "const value = 1;", highlight: false }],
            [{ start: 6, end: 11, active: true }],
        );

        expect(segments.some((segment) => segment.searchActive && segment.value === "value")).toBe(true);
    });
});
