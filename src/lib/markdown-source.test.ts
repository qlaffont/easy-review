import { describe, expect, it } from "vitest";

import { prepareMarkdownSource } from "#/lib/markdown-source.ts";

describe("prepareMarkdownSource", () => {
    it("removes HTML comments used by bots", () => {
        expect(
            prepareMarkdownSource(
                '<!-- auto -->\n> [!IMPORTANT]\n> Review skipped\n\n<!-- {"checkboxId":"x"} -->\n',
            ).trim(),
        ).toBe("> [!IMPORTANT]\n> Review skipped");
    });

    it("strips empty paragraph / break noise that creates large comment gaps", () => {
        expect(prepareMarkdownSource("Before\n\n<p>&nbsp;</p>\n<p><br></p>\n<div></div>\n\n---\n\nAfter").trim()).toBe(
            "Before\n\n---\n\nAfter",
        );
    });

    it("moves an opening fence that shares a line with preceding text onto its own line", () => {
        const prepared = prepareMarkdownSource("Alexis Communau: ```\n/\n├── model/\n```");
        expect(prepared).toBe("Alexis Communau:\n```\n/\n├── model/\n```");
    });

    it("keeps blockquoted fences inside the quote so body lines do not retain stray > markers", () => {
        const source = ["> [!CAUTION]", "> Watch out.", ">", "> ```diff", "> + added", "> - removed", "> ```"].join(
            "\n",
        );
        expect(prepareMarkdownSource(source)).toBe(source);
    });

    it("keeps prose+fence inside a blockquote on separate quoted lines", () => {
        const prepared = prepareMarkdownSource("> Note: ```\n> code\n> ```");
        expect(prepared).toBe("> Note:\n> ```\n> code\n> ```");
    });

    it("leaves already-valid fences alone", () => {
        const source = "Hello:\n```\n/\n├── model/\n```";
        expect(prepareMarkdownSource(source)).toBe(source);
    });
});
