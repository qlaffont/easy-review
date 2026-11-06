import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const TOKEN = "test_cred_valid";
const REFUSED = new EasyReviewError("unknown", "GitHub said no");
const LINE = { path: "src/a.ts", line: 1, side: "RIGHT" as const };

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithPr() {
    const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
    await session.connect(TOKEN);
    await session.loadPullRequest("acme/api", 1);
    await session.loadReviewThreads("acme/api", 1);
    await session.loadConversationComments("acme/api", 1);
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
        reviewRequests: ["quentin"],
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

describe("actions shown before GitHub answers", () => {
    it("shows a reply at once, then swaps in the confirmed one", async () => {
        const session = await connectedWithPr();
        const release = github.deferNext();

        const reply = session.replyToReviewThread("acme/api", 1, "thread-1", "Done");

        const shown = session.getReviewThreads("acme/api", 1).items[0]!.comments[1]!;
        expect(shown).toMatchObject({ body: "Done", author: "quentin", sending: true });

        release();
        await reply;
        const confirmed = session.getReviewThreads("acme/api", 1).items[0]!.comments[1]!;
        expect(confirmed.body).toBe("Done");
        expect(confirmed.sending).toBeUndefined();
        expect(confirmed.databaseId).toBeGreaterThan(0);
    });

    it("takes a refused reply back out", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const reply = session.replyToReviewThread("acme/api", 1, "thread-1", "Done");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments).toHaveLength(2);

        await expect(reply).rejects.toThrow("GitHub said no");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments).toHaveLength(1);
    });

    it("shows a single line comment at once, and removes it if refused", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const comment = session.addSingleLineComment("acme/api", 1, { ...LINE, line: 2, body: "ship it" });
        const threads = session.getReviewThreads("acme/api", 1).items;
        expect(threads).toHaveLength(2);
        expect(threads[1]).toMatchObject({ path: "src/a.ts", line: 2, side: "RIGHT" });
        expect(threads[1]!.comments[0]).toMatchObject({ body: "ship it", sending: true });

        await expect(comment).rejects.toThrow("GitHub said no");
        expect(session.getReviewThreads("acme/api", 1).items).toHaveLength(1);
    });

    it("posts a conversation comment at once, and undoes it and the count if refused", async () => {
        const session = await connectedWithPr();
        const countBefore = session.getPullRequestPage("acme/api", 1).detail!.commentCount;
        github.failNextWith(REFUSED);

        const comment = session.addPullRequestComment("acme/api", 1, "Nice work");
        expect(session.getConversationComments("acme/api", 1).items.at(-1)).toMatchObject({
            kind: "comment",
            body: "Nice work",
            sending: true,
        });
        expect(session.getPullRequestPage("acme/api", 1).detail!.commentCount).toBe(countBefore + 1);

        await expect(comment).rejects.toThrow("GitHub said no");
        expect(session.getConversationComments("acme/api", 1).items).toHaveLength(0);
        expect(session.getPullRequestPage("acme/api", 1).detail!.commentCount).toBe(countBefore);
    });

    it("resolves at once, and reopens if refused", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const resolving = session.setReviewThreadResolved("acme/api", 1, "thread-1", true);
        expect(session.getReviewThreads("acme/api", 1).items[0]!.isResolved).toBe(true);

        await expect(resolving).rejects.toThrow("GitHub said no");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.isResolved).toBe(false);
    });

    it("adds a reaction at once, and takes it back if refused", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const reacting = session.toggleReviewCommentReaction("acme/api", 1, 1, "+1");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments[0]!.reactionGroups).toEqual([
            { content: "+1", count: 1, viewerHasReacted: true },
        ]);

        await expect(reacting).rejects.toThrow("GitHub said no");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments[0]!.reactionGroups).toEqual([]);
    });

    it("keeps an edit on screen while it is sent, and restores the old text if refused", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const editing = session.updateReviewComment("acme/api", 1, "c1", "Better wording");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments[0]!.body).toBe("Better wording");

        await expect(editing).rejects.toThrow("GitHub said no");
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments[0]!.body).toBe("Please rename this.");
    });

    it("does not let a read that overlapped a write remove it from the screen", async () => {
        const session = await connectedWithPr();
        const release = github.deferNext();

        const reply = session.replyToReviewThread("acme/api", 1, "thread-1", "Done");
        await session.loadReviewThreads("acme/api", 1);

        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments).toHaveLength(2);

        release();
        await reply;
        expect(session.getReviewThreads("acme/api", 1).items[0]!.comments).toHaveLength(2);
    });
});

describe("staged comments", () => {
    it("shows a staged comment at once, and removes it if refused", async () => {
        const session = await connectedWithPr();
        github.failNextWith(REFUSED);

        const staging = session.addPendingComment("acme/api", 1, { ...LINE, body: "nit" });
        expect(session.getReviewDraft("acme/api", 1).comments.map((comment) => comment.body)).toEqual(["nit"]);

        await expect(staging).rejects.toThrow("GitHub said no");
        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);
    });

    it("opens one pending review when comments are staged in quick succession", async () => {
        const session = await connectedWithPr();

        await Promise.all([
            session.addPendingComment("acme/api", 1, { ...LINE, body: "first" }),
            session.addPendingComment("acme/api", 1, { ...LINE, line: 2, body: "second" }),
        ]);

        expect(github.calls.filter((call) => call === "createPendingReview")).toHaveLength(1);
        expect(github.calls.filter((call) => call === "addPullRequestReviewThread")).toHaveLength(2);
        const { comments } = session.getReviewDraft("acme/api", 1);
        expect(comments.map((comment) => comment.body)).toEqual(["first", "second"]);
        expect(comments.every((comment) => comment.githubCommentNodeId)).toBe(true);
    });

    it("keeps a saved draft when the first comment of a session lands on top of it", async () => {
        const first = await connectedWithPr();
        await first.addPendingComment("acme/api", 1, { ...LINE, body: "from last time" });

        const session = await connectedWithPr();
        await session.addPendingComment("acme/api", 1, { ...LINE, line: 2, body: "new" });

        expect(session.getReviewDraft("acme/api", 1).comments.map((comment) => comment.body)).toEqual([
            "from last time",
            "new",
        ]);
    });

    it("never uploads a comment removed before its turn came", async () => {
        const session = await connectedWithPr();
        await session.setReviewBody("acme/api", 1, "summary");
        const staged = session.addPendingComment("acme/api", 1, { ...LINE, body: "oops" });
        const { id } = session.getReviewDraft("acme/api", 1).comments[0]!;

        await Promise.all([staged, session.removePendingComment("acme/api", 1, id)]);

        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);
        expect(github.calls).not.toContain("addPullRequestReviewThread");
    });

    it("deletes a comment on GitHub when it was removed while uploading", async () => {
        const session = await connectedWithPr();
        const upload = github.addPullRequestReviewThread.bind(github);
        let release = () => {};
        const uploading = new Promise<void>((resolve) => {
            github.addPullRequestReviewThread = async (...args) => {
                resolve();
                await new Promise<void>((finish) => {
                    release = finish;
                });
                return upload(...args);
            };
        });

        const staged = session.addPendingComment("acme/api", 1, { ...LINE, body: "oops" });
        await uploading;
        const { id } = session.getReviewDraft("acme/api", 1).comments[0]!;
        const removed = session.removePendingComment("acme/api", 1, id);
        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);

        release();
        await Promise.all([staged, removed]);
        expect(session.getReviewDraft("acme/api", 1).comments).toEqual([]);
        expect(github.calls).toContain("deletePendingReviewComment");
    });

    it("reuses the pending review when a refused comment is retried", async () => {
        const session = await connectedWithPr();
        github.getViewerPendingReview = () =>
            Promise.resolve({ reviewId: 1, reviewNodeId: "PRR_test", commitId: "sha-aaa", body: "" });
        const upload = github.addPullRequestReviewThread.bind(github);
        github.addPullRequestReviewThread = () => {
            github.addPullRequestReviewThread = upload;
            return Promise.reject(REFUSED);
        };

        await expect(session.addPendingComment("acme/api", 1, { ...LINE, body: "nit" })).rejects.toThrow();
        github.calls.length = 0;
        await session.addPendingComment("acme/api", 1, { ...LINE, body: "nit" });

        expect(github.calls).not.toContain("createPendingReview");
        expect(github.calls).toContain("addPullRequestReviewThread");
    });
});

describe("submitting a review", () => {
    it("clears the draft and shows the verdict at once", async () => {
        const session = await connectedWithPr();
        await session.setReviewEvent("acme/api", 1, "approve");
        await session.addPendingComment("acme/api", 1, { ...LINE, body: "lgtm" });
        const release = github.deferNext();

        const submission = session.submitReview("acme/api", 1);
        await Promise.resolve();

        expect(session.getReviewDraft("acme/api", 1)).toMatchObject({ comments: [], event: "comment", body: "" });
        const shownThread = session.getReviewThreads("acme/api", 1).items.at(-1)!;
        expect(shownThread.comments[0]).toMatchObject({ body: "lgtm", sending: true });
        const detail = session.getPullRequestPage("acme/api", 1).detail!;
        expect(detail.reviewers).toContainEqual(expect.objectContaining({ login: "quentin", state: "approved" }));
        expect(detail.reviewRequests).not.toContain("quentin");

        release();
        await submission;
        expect(github.submittedReviews).toHaveLength(1);
    });

    it("includes a comment staged just before submitting, even if it is still uploading", async () => {
        const session = await connectedWithPr();
        await session.setReviewEvent("acme/api", 1, "approve");

        const staged = session.addPendingComment("acme/api", 1, { ...LINE, body: "lgtm" });
        const submission = session.submitReview("acme/api", 1);
        await Promise.all([staged, submission]);

        const staging = github.calls.indexOf("addPullRequestReviewThread");
        expect(staging).toBeGreaterThanOrEqual(0);
        expect(github.calls.indexOf("submitReview")).toBeGreaterThan(staging);
        expect(github.calls.filter((call) => call === "createPendingReview")).toHaveLength(1);
        expect(github.submittedReviews[0]).toMatchObject({ event: "approve", comments: [] });
    });

    it("restores the draft and the verdict when GitHub refuses the review", async () => {
        const session = await connectedWithPr();
        await session.setReviewEvent("acme/api", 1, "approve");
        await session.setReviewBody("acme/api", 1, "Looks good");
        await session.addPendingComment("acme/api", 1, { ...LINE, body: "lgtm" });
        const requestsBefore = session.getPullRequestPage("acme/api", 1).detail!.reviewRequests;
        github.failNextWith(REFUSED);

        await expect(session.submitReview("acme/api", 1)).rejects.toThrow("GitHub said no");

        expect(session.getReviewDraft("acme/api", 1)).toMatchObject({ event: "approve", body: "Looks good" });
        expect(session.getReviewDraft("acme/api", 1).comments.map((comment) => comment.body)).toEqual(["lgtm"]);
        expect(
            session.getReviewThreads("acme/api", 1).items.some((thread) => thread.comments[0]?.sending === true),
        ).toBe(false);
        expect(session.getPullRequestPage("acme/api", 1).detail!.reviewRequests).toEqual(requestsBefore);

        await session.submitReview("acme/api", 1);
        expect(github.submittedReviews).toHaveLength(1);
    });

    it("says why a review cannot be sent without touching the draft", async () => {
        const session = await connectedWithPr();
        await session.setReviewBody("acme/api", 1, "");

        await expect(session.getReviewBlockedReason("acme/api", 1)).resolves.toBe(
            "Add a comment or a summary before submitting a review.",
        );
        await expect(session.submitReview("acme/api", 1)).rejects.toThrow("Add a comment");
        expect(github.submittedReviews).toEqual([]);
    });

    it("uploads comments the pending review never received", async () => {
        github.getViewerPendingReview = () =>
            Promise.resolve({ reviewId: 1, reviewNodeId: "PRR_test", commitId: "sha-aaa", body: "" });
        await store.set(
            "review-draft:quentin:acme/api#1",
            JSON.stringify({
                repository: "acme/api",
                number: 1,
                headSha: "sha-aaa",
                event: "comment",
                body: "",
                stale: false,
                comments: [{ ...LINE, id: "local", body: "left behind by a closed tab" }],
            }),
        );
        const session = await connectedWithPr();

        await session.submitReview("acme/api", 1);

        expect(github.calls.filter((call) => call === "addPullRequestReviewThread")).toHaveLength(1);
        expect(github.calls.indexOf("submitReview")).toBeGreaterThan(
            github.calls.indexOf("addPullRequestReviewThread"),
        );
        expect(github.submittedReviews[0]).toMatchObject({ comments: [] });
    });

    it("sends a merge clicked right after approving only once the approval is through", async () => {
        const session = await connectedWithPr();
        await session.setReviewEvent("acme/api", 1, "approve");

        const submission = session.submitReview("acme/api", 1);
        const merge = session.mergePullRequest("acme/api", 1, "squash");
        await Promise.all([submission, merge]);

        expect(github.calls.indexOf("mergePullRequest")).toBeGreaterThan(github.calls.indexOf("submitReview"));
    });
});
