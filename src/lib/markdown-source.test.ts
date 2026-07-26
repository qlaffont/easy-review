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
});
