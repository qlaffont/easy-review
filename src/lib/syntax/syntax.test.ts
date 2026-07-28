import { describe, expect, it } from "vitest";

import { languageFromPath } from "#/lib/syntax/language-from-path.ts";
import { mergeSyntaxWithWordDiff } from "#/lib/syntax/merge-syntax-word-diff.ts";

describe("languageFromPath", () => {
    it("maps common extensions", () => {
        expect(languageFromPath("src/InvoiceService.kt")).toBe("kotlin");
        expect(languageFromPath("Foo.java")).toBe("java");
        expect(languageFromPath("app.tsx")).toBe("tsx");
    });

    it("maps special filenames", () => {
        expect(languageFromPath("Dockerfile")).toBe("dockerfile");
        expect(languageFromPath(".env.example")).toBe("dotenv");
    });

    it("returns null for unknown paths", () => {
        expect(languageFromPath("notes.weirdext")).toBeNull();
        expect(languageFromPath("LICENSE")).toBeNull();
    });
});

describe("mergeSyntaxWithWordDiff", () => {
    it("keeps syntax colors under word highlights", () => {
        const segments = mergeSyntaxWithWordDiff(
            "fun get()",
            [
                { content: "fun", color: "#ff0000", offset: 0 },
                { content: " ", offset: 3 },
                { content: "get", color: "#0000ff", offset: 4 },
                { content: "()", offset: 7 },
            ],
            [
                { value: "fun ", added: false, removed: false, count: 1 },
                { value: "get", added: true, removed: false, count: 1 },
                { value: "()", added: false, removed: false, count: 1 },
            ],
            "add",
        );

        expect(segments).toEqual([
            { value: "fun", color: "#ff0000", fontStyle: undefined, highlight: false },
            { value: " ", color: undefined, fontStyle: undefined, highlight: false },
            { value: "get", color: "#0000ff", fontStyle: undefined, highlight: true },
            { value: "()", color: undefined, fontStyle: undefined, highlight: false },
        ]);
    });

    it("falls back to plain text when tokens do not match", () => {
        const segments = mergeSyntaxWithWordDiff("abc", [{ content: "ab", offset: 0 }], null, "add");
        expect(segments).toEqual([{ value: "abc", highlight: false }]);
    });
});
