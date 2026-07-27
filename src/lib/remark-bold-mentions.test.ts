import type { Root } from "mdast";

import { describe, expect, it } from "vitest";

import { remarkBoldMentions } from "#/lib/remark-bold-mentions.ts";

function runParagraph(text: string): Root {
    const tree: Root = {
        type: "root",
        children: [
            {
                type: "paragraph",
                children: [{ type: "text", value: text }],
            },
        ],
    };
    remarkBoldMentions()(tree);
    return tree;
}

describe("remarkBoldMentions", () => {
    it("wraps bare @mentions in strong", () => {
        const tree = runParagraph("@mohamed-maalej / @Nabellaleen");
        expect(tree.children[0]).toEqual({
            type: "paragraph",
            children: [
                { type: "strong", children: [{ type: "text", value: "@mohamed-maalej" }] },
                { type: "text", value: " / " },
                { type: "strong", children: [{ type: "text", value: "@Nabellaleen" }] },
            ],
        });
    });

    it("does not bold the domain side of an email", () => {
        const tree = runParagraph("ping user@example.com please");
        expect(tree.children[0]).toEqual({
            type: "paragraph",
            children: [{ type: "text", value: "ping user@example.com please" }],
        });
    });

    it("leaves mentions inside links alone", () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "link",
                            url: "https://github.com/octocat",
                            children: [{ type: "text", value: "@octocat" }],
                        },
                    ],
                },
            ],
        };
        remarkBoldMentions()(tree);
        expect(tree.children[0]).toEqual({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: "https://github.com/octocat",
                    children: [{ type: "text", value: "@octocat" }],
                },
            ],
        });
    });
});
