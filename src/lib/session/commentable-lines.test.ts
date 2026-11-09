import { describe, expect, it } from "vitest";

import { isCommentableLine, parseCommentableLines } from "#/lib/session/commentable-lines.ts";

describe("parseCommentableLines", () => {
    it("reads each hunk's old and new ranges", () => {
        const patch = ["@@ -6,6 +6,7 @@ resources:", "   - a", "+  - b", "@@ -40,3 +41,2 @@", "-gone"].join("\n");

        expect(parseCommentableLines(patch)).toEqual({
            left: [
                [6, 11],
                [40, 42],
            ],
            right: [
                [6, 12],
                [41, 42],
            ],
        });
    });

    it("handles added files and single-line counts", () => {
        expect(parseCommentableLines("@@ -0,0 +1,5 @@\n+a")).toEqual({ left: [], right: [[1, 5]] });
        expect(parseCommentableLines("@@ -3 +3 @@\n-a\n+b")).toEqual({ left: [[3, 3]], right: [[3, 3]] });
    });
});

describe("isCommentableLine", () => {
    const lines = { left: [[6, 11]] as Array<[number, number]>, right: [[6, 12]] as Array<[number, number]> };

    it("accepts lines inside a hunk on the matching side", () => {
        expect(isCommentableLine(lines, "RIGHT", 12)).toBe(true);
        expect(isCommentableLine(lines, "LEFT", 6)).toBe(true);
    });

    it("refuses expanded context outside the hunks", () => {
        expect(isCommentableLine(lines, "RIGHT", 1)).toBe(false);
        expect(isCommentableLine(lines, "LEFT", 12)).toBe(false);
    });

    it("allows every line when the ranges are unknown", () => {
        expect(isCommentableLine(undefined, "RIGHT", 999)).toBe(true);
    });
});
