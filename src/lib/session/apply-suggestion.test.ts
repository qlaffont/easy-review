import { describe, expect, it } from "vitest";

import {
    applySuggestionsToFile,
    assertSuggestionCurrent,
    defaultSuggestionCommitMessage,
    replaceLines,
} from "#/lib/session/apply-suggestion.ts";

describe("replaceLines", () => {
    it("inserts a line inside a block", () => {
        const before = ["a", "b", "c", "d"].join("\n") + "\n";
        expect(replaceLines(before, 2, 3, "b\nX\nc")).toBe("a\nb\nX\nc\nd\n");
    });

    it("deletes a range when replacement is empty", () => {
        expect(replaceLines("a\nb\nc\n", 2, 2, "")).toBe("a\nc\n");
    });

    it("rejects ranges past the end of the file", () => {
        expect(() => replaceLines("a\n", 1, 3, "x")).toThrow("outside");
    });
});

describe("assertSuggestionCurrent", () => {
    it("accepts a matching original span", () => {
        expect(() => assertSuggestionCurrent("a\nb\nc\n", 2, 2, "b")).not.toThrow();
    });

    it("rejects when the file moved on", () => {
        expect(() => assertSuggestionCurrent("a\nZ\nc\n", 2, 2, "b")).toThrow("outdated");
    });
});

describe("applySuggestionsToFile", () => {
    it("applies bottom-to-top so earlier line numbers stay valid", () => {
        const next = applySuggestionsToFile("1\n2\n3\n4\n", [
            { path: "f", startLine: 1, endLine: 1, replacement: "A", original: "1" },
            { path: "f", startLine: 3, endLine: 3, replacement: "C", original: "3" },
        ]);
        expect(next).toBe("A\n2\nC\n4\n");
    });
});

describe("defaultSuggestionCommitMessage", () => {
    it("names a single path", () => {
        expect(defaultSuggestionCommitMessage(["src/a.ts"])).toBe("Update src/a.ts");
    });

    it("counts multiple paths", () => {
        expect(defaultSuggestionCommitMessage(["a", "b"])).toBe("Apply 2 suggestions");
    });
});
