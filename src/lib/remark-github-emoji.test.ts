import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "#/components/pr/markdown.tsx";

function renderMarkdown(source: string): string {
    return renderToStaticMarkup(createElement(Markdown, { source, baseUrl: "https://github.com/acme/api" }));
}

describe("remarkGithubEmoji", () => {
    it("renders gemoji shortcodes as emoji characters", () => {
        const html = renderMarkdown("Looks good :+1: and :rocket:");
        expect(html).toContain("👍");
        expect(html).toContain("🚀");
        expect(html).not.toContain(":+1:");
        expect(html).not.toContain(":rocket:");
    });

    it("maps Slack-style :thinking_face: to the thinking emoji", () => {
        const html = renderMarkdown("hmm :thinking_face:");
        expect(html).toContain("🤔");
        expect(html).not.toContain(":thinking_face:");
    });

    it("leaves unknown shortcodes untouched", () => {
        const html = renderMarkdown(":not_a_real_emoji_zz:");
        expect(html).toContain(":not_a_real_emoji_zz:");
    });

    it("does not rewrite shortcodes inside fenced code", () => {
        const html = renderMarkdown("```\n:rocket:\n```");
        expect(html).toContain(":rocket:");
        expect(html).not.toContain("🚀");
    });
});
