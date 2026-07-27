import { describe, expect, it } from "vitest";

import { buildFileDiff, DIFF_EXPAND_CHUNK, expandDiffGap, materializeFileDiff } from "#/lib/session/build-file-diff.ts";

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

describe("buildFileDiff", () => {
    it("includes a few context lines around a change and a gap for distant unchanged code", () => {
        const before = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join("\n") + "\n";
        const afterLines = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`);
        afterLines[19] = "line-20-changed";
        const after = afterLines.join("\n") + "\n";

        const diff = buildFileDiff({ path: "a.ts", before: text(before), after: text(after) });

        expect(diff.stub).toBeNull();
        expect(diff.beforeText).toContain("line-1");
        expect(diff.afterText).toContain("line-20-changed");
        expect(diff.lines.some((line) => line.kind === "del" && line.text === "line-20")).toBe(true);
        expect(diff.lines.some((line) => line.kind === "add" && line.text === "line-20-changed")).toBe(true);
        expect(diff.lines.some((line) => line.kind === "context" && line.text === "line-19")).toBe(true);
        expect(diff.lines.some((line) => line.kind === "gap")).toBe(true);
        // Distant head of the file stays collapsed.
        expect(diff.lines.some((line) => line.kind === "context" && line.text === "line-1")).toBe(false);
    });

    it("expands a gap downward by a chunk of lines", () => {
        const before = Array.from({ length: 60 }, (_, index) => `L${index + 1}`).join("\n");
        const afterLines = Array.from({ length: 60 }, (_, index) => `L${index + 1}`);
        afterLines[49] = "L50-edit";
        const after = afterLines.join("\n");

        const base = materializeFileDiff("a.ts", before, after);
        const gap = base.lines.find((line) => line.kind === "gap");
        expect(gap?.gap).toBeTruthy();

        const expansions = expandDiffGap({}, gap!.gap!.id, "down", DIFF_EXPAND_CHUNK);
        const expanded = materializeFileDiff("a.ts", before, after, { expansions });

        expect(expanded.lines.some((line) => line.kind === "context" && line.text === "L1")).toBe(true);
        expect(
            expanded.lines.filter((line) => line.kind === "context" && /^L\d+$/.test(line.text)).length,
        ).toBeGreaterThan(base.lines.filter((line) => line.kind === "context" && /^L\d+$/.test(line.text)).length);
    });

    it("marks top-of-file gaps as expand-up only and bottom-of-file as expand-down only", () => {
        const before = Array.from({ length: 80 }, (_, index) => `L${index + 1}`).join("\n");
        const afterLines = Array.from({ length: 80 }, (_, index) => `L${index + 1}`);
        afterLines[39] = "L40-edit";
        const after = afterLines.join("\n");

        const diff = materializeFileDiff("a.ts", before, after);
        const gaps = diff.lines.filter((line) => line.kind === "gap").map((line) => line.gap!);
        expect(gaps.length).toBeGreaterThanOrEqual(2);

        const top = gaps[0]!;
        const bottom = gaps[gaps.length - 1]!;
        expect(top.expandDown).toBe(false);
        expect(top.expandUp).toBe(true);
        expect(bottom.expandDown).toBe(true);
        expect(bottom.expandUp).toBe(false);
    });

    it("showFullFile reveals every line without gaps", () => {
        const before = "a\nb\nc\n";
        const after = "a\nB\nc\n";
        const diff = materializeFileDiff("a.ts", before, after, { showFullFile: true });

        expect(diff.lines.some((line) => line.kind === "gap")).toBe(false);
        expect(diff.lines.some((line) => line.kind === "context" && line.text === "a")).toBe(true);
        expect(diff.lines.some((line) => line.kind === "context" && line.text === "c")).toBe(true);
    });

    it("ignoreWhitespace collapses pure indent changes", () => {
        const before = "foo()\n";
        const after = "  foo()\n";
        const shown = materializeFileDiff("a.ts", before, after);
        const hidden = materializeFileDiff("a.ts", before, after, { ignoreWhitespace: true });

        expect(shown.lines.some((line) => line.kind === "del" || line.kind === "add")).toBe(true);
        expect(hidden.lines.some((line) => line.kind === "del" || line.kind === "add")).toBe(false);
    });
});
