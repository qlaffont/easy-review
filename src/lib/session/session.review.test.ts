import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithPr() {
    const session = createEasyReviewSession({ github, store });
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
        line: 1,
        side: "RIGHT",
        isResolved: false,
        comments: [
            {
                id: "c1",
                author: "hubot",
                body: "Please rename this.",
                createdAt: "2026-07-01T00:00:00.000Z",
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

        const reloaded = createEasyReviewSession({ github, store });
        await reloaded.restore();
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
                comments: [{ path: "src/a.ts", line: 1, side: "RIGHT", body: "rename me" }],
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
        const session = createEasyReviewSession({ github, store });
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

    it("forgets staged drafts when another account connects on the same browser", async () => {
        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, {
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "quentin's note",
        });

        github.addAccount("github_pat_other", { login: "hubot" });
        github.addPullRequest("github_pat_other", {
            repository: "acme/api",
            number: 1,
            headSha: "sha-aaa",
            title: "Ship reviews",
        });

        await session.connect("github_pat_other");
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
});
