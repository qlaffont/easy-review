import { describe, expect, it } from "vitest";

import { insertBlock, insertLink, prefixLines, wrapSelection } from "#/lib/markdown-edit.ts";

describe("wrapSelection", () => {
    it("wraps an empty selection with a placeholder", () => {
        expect(wrapSelection("hello", 5, 5, "**", "**", "bold")).toEqual({
            value: "hello**bold**",
            selectionStart: 7,
            selectionEnd: 11,
        });
    });

    it("wraps the current selection", () => {
        expect(wrapSelection("say hi", 4, 6, "**", "**")).toEqual({
            value: "say **hi**",
            selectionStart: 6,
            selectionEnd: 8,
        });
    });

    it("unwraps when delimiters already surround the selection", () => {
        expect(wrapSelection("say **hi**", 6, 8, "**", "**")).toEqual({
            value: "say hi",
            selectionStart: 4,
            selectionEnd: 6,
        });
    });
});

describe("prefixLines", () => {
    it("prefixes the current line", () => {
        expect(prefixLines("one\ntwo", 5, 5, "> ")).toEqual({
            value: "one\n> two",
            selectionStart: 4,
            selectionEnd: 9,
        });
    });

    it("toggles the prefix off", () => {
        expect(prefixLines("> two", 0, 5, "> ")).toEqual({
            value: "two",
            selectionStart: 0,
            selectionEnd: 3,
        });
    });
});

describe("insertBlock", () => {
    it("adds newlines so the block sits on its own lines", () => {
        expect(insertBlock("before after", 6, 6, "---")).toEqual({
            value: "before\n---\n after",
            selectionStart: 10,
            selectionEnd: 10,
        });
    });
});

describe("insertLink", () => {
    it("selects the url placeholder", () => {
        expect(insertLink("see ", 4, 4)).toEqual({
            value: "see [link text](url)",
            selectionStart: 16,
            selectionEnd: 19,
        });
    });
});
