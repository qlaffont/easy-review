import type { PhrasingContent, Root } from "mdast";

import { describe, expect, it } from "vitest";

import { remarkGithubReferences } from "#/lib/remark-github-references.ts";

function run(children: Array<PhrasingContent>, repository: string | null = "latomate/medical-web") {
    const tree: Root = { type: "root", children: [{ type: "paragraph", children }] };
    remarkGithubReferences({ repository })(tree);
    const paragraph = tree.children[0];
    return paragraph?.type === "paragraph" ? paragraph.children : [];
}

function link(url: string, value: string): PhrasingContent {
    return { type: "link", url, children: [{ type: "text", value }] };
}

describe("remarkGithubReferences", () => {
    it("links cross-repository references", () => {
        expect(run([{ type: "text", value: "Service : latomate/medical-service#500" }])).toEqual([
            { type: "text", value: "Service : " },
            link("https://github.com/latomate/medical-service/issues/500", "latomate/medical-service#500"),
        ]);
    });

    it("links bare references to the current repository", () => {
        expect(run([{ type: "text", value: "fixes #731." }])).toEqual([
            { type: "text", value: "fixes " },
            link("https://github.com/latomate/medical-web/issues/731", "#731"),
            { type: "text", value: "." },
        ]);
    });

    it("leaves bare references as text without a repository", () => {
        expect(run([{ type: "text", value: "fixes #731" }], null)).toEqual([{ type: "text", value: "fixes #731" }]);
    });

    it("ignores references glued to words, paths or followed by letters", () => {
        const value = "abc#1 docs/#2 #3abc a.b#4";
        expect(run([{ type: "text", value }])).toEqual([{ type: "text", value }]);
    });

    it("does not relink text already inside a link", () => {
        const existing = link("https://example.com", "see #12");
        expect(run([existing])).toEqual([existing]);
    });
});
