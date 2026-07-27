import { describe, expect, it } from "vitest";

import { parseDiffHunk, suggestionOriginalFromHunk, trimHunkToFocus } from "#/components/pr/diff-hunk-preview.tsx";

describe("trimHunkToFocus", () => {
    it("keeps a short hunk intact", () => {
        const lines = parseDiffHunk("@@ -1,2 +1,2 @@\n a\n-b\n+c");
        expect(trimHunkToFocus(lines, 2, "RIGHT")).toHaveLength(lines.length);
    });

    it("windows a large addition hunk around the commented line", () => {
        const body = Array.from({ length: 40 }, (_, index) => `+line ${index + 1}`).join("\n");
        const lines = parseDiffHunk(`@@ -0,0 +1,40 @@\n${body}`);
        const trimmed = trimHunkToFocus(lines, 37, "RIGHT");

        expect(trimmed.length).toBeLessThanOrEqual(6);
        expect(trimmed.at(-1)?.newNumber).toBe(37);
        expect(trimmed[0]?.newNumber).toBeGreaterThan(30);
    });
});

describe("suggestionOriginalFromHunk", () => {
    it("pulls the replaced head-file lines for a multi-line RIGHT suggestion", () => {
        const hunk = [
            "@@ -78,6 +78,6 @@",
            " const a = 1;",
            ' console.log("body");',
            " console.log(body);",
            ' const headers = "x";',
            " return tlsiResponse;",
            " };",
        ].join("\n");

        expect(suggestionOriginalFromHunk(hunk, 79, 81, "RIGHT")).toBe(
            [' console.log("body");', " console.log(body);", ' const headers = "x";']
                .map((line) => line.slice(1))
                .join("\n"),
        );
    });

    it("returns null when the hunk does not cover the range", () => {
        expect(suggestionOriginalFromHunk("@@ -1,1 +1,1 @@\n one", 10, 12, "RIGHT")).toBeNull();
    });
});
