import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PendingLineComment, ReviewThread, ReviewThreadComment } from "#/lib/session/types.ts";

vi.mock("#/lib/session/provider.tsx", () => ({
    useSession: () => ({}),
}));

vi.mock("#/components/ui/relative-time.tsx", () => ({
    RelativeTime: () => null,
}));

vi.mock("#/components/pr/markdown-composer.tsx", () => ({
    MarkdownComposer: () => null,
}));

vi.mock("#/components/pr/markdown.tsx", () => ({
    Markdown: ({ source }: { source: string }) => createElement("p", null, source),
}));

import { InlineDiffComments } from "#/components/pr/inline-diff-comments.tsx";

const comment: ReviewThreadComment = {
    id: "comment-1",
    databaseId: 1,
    author: "hubot",
    authorAvatarUrl: null,
    body: "Please rename this.",
    createdAt: "2026-09-07T00:00:00.000Z",
    url: "https://github.com/acme/api/pull/1#discussion_r1",
    reactionGroups: [],
};

const thread: ReviewThread = {
    id: "thread-1",
    path: "src/a.ts",
    startLine: null,
    line: 1,
    side: "RIGHT",
    isResolved: false,
    isOutdated: false,
    diffHunk: null,
    comments: [comment],
};

const pending: PendingLineComment = { id: "p1", path: "src/a.ts", line: 1, side: "RIGHT", body: "My pending note." };

function render(props: { minimized: boolean; threads?: Array<ReviewThread>; pending?: Array<PendingLineComment> }) {
    return renderToStaticMarkup(
        createElement(InlineDiffComments, {
            side: "RIGHT",
            line: 1,
            lineText: "two",
            pending: [],
            threads: [],
            viewerLogin: "quentin",
            viewerAvatarUrl: null,
            previewBaseUrl: "https://github.com/acme/api/",
            repository: "acme/api",
            number: 1,
            onRemovePending: () => Promise.resolve(),
            onUpdatePending: () => Promise.resolve(),
            onReply: () => Promise.resolve(),
            ...props,
        }),
    );
}

describe("InlineDiffComments", () => {
    it("shows the whole comment by default", () => {
        const html = render({ minimized: false, threads: [thread], pending: [pending] });

        expect(html).toContain("Please rename this.");
        expect(html).toContain("My pending note.");
    });

    it("keeps minimized comments on the diff as headers that can be opened", () => {
        const html = render({ minimized: true, threads: [thread], pending: [pending] });

        expect(html).toContain("Comment on line R1");
        expect(html).toContain("(pending review)");
        expect(html).not.toContain("Please rename this.");
        expect(html).not.toContain("My pending note.");
    });

    it("marks a comment GitHub has not confirmed and offers no action on it yet", () => {
        const sending = { ...thread, comments: [{ ...comment, url: "", databaseId: 0, sending: true }] };
        const html = render({ minimized: false, threads: [sending] });

        expect(html).toContain("Sending…");
        expect(html).toContain("Please rename this.");
        expect(html).not.toContain("Comment actions");
        expect(html).not.toContain("Add reaction");
        expect(html).not.toContain("Reply…");
    });
});
