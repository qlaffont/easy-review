import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReviewThread } from "#/lib/session/types.ts";

const resolvedThread: ReviewThread = {
    id: "thread-1",
    path: "src/barcode.ts",
    startLine: null,
    line: 4,
    side: "RIGHT",
    isResolved: true,
    isOutdated: false,
    diffHunk: null,
    comments: [
        {
            id: "comment-1",
            databaseId: 1,
            author: "quentin",
            authorAvatarUrl: null,
            body: "This needs a validation callback.",
            createdAt: "2026-09-07T00:00:00.000Z",
            url: "https://github.com/acme/api/pull/1#discussion_r1",
            reactionGroups: [],
        },
    ],
};

vi.mock("#/lib/query/pull-request.ts", () => ({
    useReviewThreadsQuery: () => ({ status: "ready", items: [resolvedThread] }),
}));

vi.mock("#/lib/session/provider.tsx", () => ({
    useSession: () => ({ setReviewThreadResolved: vi.fn() }),
}));

vi.mock("#/components/ui/button.tsx", () => ({
    Button: ({ children }: { children: string }) => createElement("button", null, children),
}));

vi.mock("#/components/ui/relative-time.tsx", () => ({
    RelativeTime: () => null,
}));

import { ReviewThreadsPanel } from "#/components/pr/review-threads.tsx";

describe("ReviewThreadsPanel", () => {
    it("offers a way to reopen a resolved thread", () => {
        const html = renderToStaticMarkup(
            createElement(ReviewThreadsPanel, { repository: "acme/api", number: 1, path: "src/barcode.ts" }),
        );

        expect(html).toContain("Reopen conversation");
    });
});
