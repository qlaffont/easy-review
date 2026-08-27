import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { setPullRequestDetailQueryData } from "#/lib/query/pull-request.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { createEasyReviewSession, pullRequestKey } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const TOKEN = "test_cred_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithPr() {
    const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
    await session.connect(TOKEN);
    await session.loadPullRequest("acme/api", 1);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 1,
        headSha: "sha-aaa",
        title: "Ship reviews",
    });
    github.setPullRequestFiles(TOKEN, "acme/api", 1, [
        { path: "src/a.ts", status: "modified", before: "one\n", after: "two\n" },
    ]);
    github.addReviewThread(TOKEN, "acme/api", 1, {
        id: "thread-1",
        path: "src/a.ts",
        startLine: null,
        line: 1,
        side: "RIGHT",
        isResolved: false,
        isOutdated: false,
        diffHunk: "@@ -1,1 +1,1 @@\n-one\n+two",
        comments: [
            {
                id: "c1",
                databaseId: 1,
                author: "hubot",
                authorAvatarUrl: null,
                body: "Please rename this.",
                createdAt: "2026-07-01T00:00:00.000Z",
                url: "https://github.com/acme/api/pull/1#discussion_r1",
                reactionGroups: [],
            },
        ],
    });
});

describe("staged review drafts", () => {
    it("keeps pending comments local until submit", async () => {
        const session = await connectedWithPr();

        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "nit: naming",
        });

        expect(github.submittedReviews).toEqual([]);
        expect(session.getReviewDraft("acme/api", 1).comments).toHaveLength(1);
    });

    it("persists the draft across a session reload", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "survives reload",
        });
        await session.setReviewEvent("acme/api", 1, "approve");

        const reloaded = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await reloaded.connect(TOKEN);
        await reloaded.loadPullRequest("acme/api", 1);

        const draft = reloaded.getReviewDraft("acme/api", 1);
        expect(draft.event).toBe("approve");
        expect(draft.comments[0]?.body).toBe("survives reload");
        expect(draft.stale).toBe(false);
    });

    it("marks the draft stale when the head SHA moves", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "aimed at old tip",
        });

        github.setPullRequestHead(TOKEN, "acme/api", 1, "sha-bbb");
        await session.refreshPullRequest("acme/api", 1);

        expect(session.getReviewDraft("acme/api", 1).stale).toBe(true);
        await expect(session.submitReview("acme/api", 1)).rejects.toMatchObject({ kind: "unknown" });
    });

    it("does not mark an empty draft stale when the head moves after submit", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "shipped",
        });
        await session.submitReview("acme/api", 1);

        github.setPullRequestHead(TOKEN, "acme/api", 1, "sha-bbb");
        await session.refreshPullRequest("acme/api", 1);

        const draft = session.getReviewDraft("acme/api", 1);
        expect(draft.stale).toBe(false);
        expect(draft.headSha).toBe("sha-bbb");
        expect(draft.comments).toEqual([]);
    });

    it("posts a single line comment immediately without touching the staged draft", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "staged",
        });

        await session.addSingleLineComment("acme/api", 1, {
            path: "src/a.ts",
            line: 2,
            side: "RIGHT",
            body: "ship it now",
        });

        expect(github.calls.filter((call) => call === "addPullRequestReviewThread")).toHaveLength(2);
        expect(github.submittedReviews).toEqual([]);
        expect(session.getReviewDraft("acme/api", 1).comments).toHaveLength(1);
        const threads = session.getReviewThreads("acme/api", 1).items;
        expect(threads).toHaveLength(3);
        expect(threads.some((thread) => thread.comments.some((comment) => comment.body === "ship it now"))).toBe(true);
    });

    it("selects a review event before GitHub pending-review sync finishes", async () => {
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);

        const detail = await github.getPullRequest(TOKEN, "acme/api", 1);
        setPullRequestDetailQueryData(session.queryClient, pullRequestKey("acme/api", 1), detail);

        const release = github.deferNext();
        const pending = session.setReviewEvent("acme/api", 1, "approve");
        await Promise.resolve();
        await Promise.resolve();

        expect(session.getReviewDraft("acme/api", 1).event).toBe("approve");

        release();
        await pending;
        expect(session.getReviewDraft("acme/api", 1).event).toBe("approve");
    });

    it("submits a review when detail lives only in the query cache", async () => {
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);

        const detail = await github.getPullRequest(TOKEN, "acme/api", 1);
        setPullRequestDetailQueryData(session.queryClient, pullRequestKey("acme/api", 1), detail);

        await session.setReviewEvent("acme/api", 1, "approve");
        await session.submitReview("acme/api", 1);

        expect(github.submittedReviews).toEqual([
            {
                repository: "acme/api",
                number: 1,
                headSha: "sha-aaa",
                event: "approve",
                body: "",
                comments: [],
            },
        ]);
    });

    it("submits one review with every pending comment and clears the draft", async () => {
        const session = await connectedWithPr();
        await session.setReviewEvent("acme/api", 1, "request-changes");
        await session.setReviewBody("acme/api", 1, "Please fix naming.");
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "rename me",
        });

        await session.submitReview("acme/api", 1);

        expect(github.submittedReviews).toEqual([
            {
                repository: "acme/api",
                number: 1,
                headSha: "sha-aaa",
                event: "request-changes",
                body: "Please fix naming.",
                comments: [],
            },
        ]);
        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);
    });

    it("can discard a stale draft and start clean on the new head", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "old",
        });
        github.setPullRequestHead(TOKEN, "acme/api", 1, "sha-bbb");
        await session.refreshPullRequest("acme/api", 1);

        await session.discardReviewDraft("acme/api", 1);

        const draft = session.getReviewDraft("acme/api", 1);
        expect(draft.stale).toBe(false);
        expect(draft.headSha).toBe("sha-bbb");
        expect(draft.comments).toEqual([]);
    });

    it("does not mark a draft stale when the first comment lands before the PR detail", async () => {
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "early note",
        });

        await session.loadPullRequest("acme/api", 1);

        const draft = session.getReviewDraft("acme/api", 1);
        expect(draft.stale).toBe(false);
        expect(draft.headSha).toBe("sha-aaa");
        expect(draft.comments[0]?.body).toBe("early note");
    });

    it("resolves threads when data lives only in the query cache", async () => {
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);
        github.addReviewThread(TOKEN, "acme/api", 1, {
            id: "thread-1",
            path: "src/a.ts",
            startLine: null,
            line: 1,
            side: "RIGHT",
            isResolved: false,
            isOutdated: false,
            diffHunk: "@@ -1,1 +1,1 @@\n-one\n+two",
            comments: [
                {
                    id: "c1",
                    databaseId: 1,
                    author: "hubot",
                    authorAvatarUrl: null,
                    body: "nit",
                    createdAt: "2026-07-01T00:00:00.000Z",
                    url: "https://example.com",
                    reactionGroups: [],
                },
            ],
        });

        const key = pullRequestKey("acme/api", 1);
        const items = await github.listReviewThreads(TOKEN, "acme/api", 1);
        session.queryClient.setQueryData(queryKeys.pullRequest.threads(key), { items });

        await session.setReviewThreadResolved("acme/api", 1, "thread-1", true);

        expect(session.getReviewThreads("acme/api", 1).items[0]?.isResolved).toBe(true);
    });

    it("forgets staged drafts when another account connects on the same browser", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "quentin's note",
        });

        github.addAccount("test_cred_other", { login: "hubot" });
        github.addPullRequest("test_cred_other", {
            repository: "acme/api",
            number: 1,
            headSha: "sha-aaa",
            title: "Ship reviews",
        });

        await session.connect("test_cred_other");
        await session.loadPullRequest("acme/api", 1);

        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);
        expect(store.entries()["review-draft:quentin:acme/api#1"]).toBeUndefined();
    });
});

describe("thread replies", () => {
    it("loads existing threads and appends a reply", async () => {
        const session = await connectedWithPr();
        await session.loadReviewThreads("acme/api", 1);

        expect(session.getReviewThreads("acme/api", 1).items[0]?.comments).toHaveLength(1);

        await session.replyToReviewThread("acme/api", 1, "thread-1", "Done in the next push.");

        expect(session.getReviewThreads("acme/api", 1).items[0]?.comments).toHaveLength(2);
        expect(session.getReviewThreads("acme/api", 1).items[0]?.comments.at(-1)?.body).toBe("Done in the next push.");
    });

    it("resolves and unresolves a review thread", async () => {
        const session = await connectedWithPr();
        await session.loadReviewThreads("acme/api", 1);

        expect(session.getReviewThreads("acme/api", 1).items[0]?.isResolved).toBe(false);

        await session.setReviewThreadResolved("acme/api", 1, "thread-1", true);
        expect(session.getReviewThreads("acme/api", 1).items[0]?.isResolved).toBe(true);

        await session.setReviewThreadResolved("acme/api", 1, "thread-1", false);
        expect(session.getReviewThreads("acme/api", 1).items[0]?.isResolved).toBe(false);
    });
});

describe("conversation comments", () => {
    it("loads and posts a pull request comment without starting a review", async () => {
        github.addConversationComment(TOKEN, "acme/api", 1, {
            id: "issue-1",
            databaseId: 1,
            author: "hubot",
            authorAvatarUrl: null,
            body: "Looks good overall.",
            createdAt: "2026-07-01T00:00:00.000Z",
            url: "https://github.com/acme/api/pull/1#issuecomment-1",
            lastEditedAt: null,
            editor: null,
            editCount: 0,
            edits: [],
            reactionGroups: [],
        });

        const session = await connectedWithPr();
        await session.loadConversationComments("acme/api", 1);

        expect(session.getConversationComments("acme/api", 1).items).toHaveLength(1);

        await session.addPullRequestComment("acme/api", 1, "Ship it.");

        const items = session.getConversationComments("acme/api", 1).items;
        expect(items).toHaveLength(2);
        expect(items.at(-1)).toMatchObject({ kind: "comment", body: "Ship it." });
        expect(session.getPullRequestPage("acme/api", 1).detail?.commentCount).toBe(1);
        expect(github.calls).toContain("listPullRequestTimeline");
        expect(github.calls).toContain("addPullRequestComment");
        expect(github.calls).not.toContain("submitReview");
    });
});
