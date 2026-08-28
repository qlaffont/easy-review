import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { queuedAutoMergeStorageKey } from "#/lib/session/queued-auto-merge.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const TOKEN = "test_cred_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithBlockedPr() {
    const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
    await session.connect(TOKEN);
    await session.setSelectedRepositories(["acme/api"]);
    await session.loadPullRequest("acme/api", 7);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addRepository(TOKEN, "acme/api");
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 7,
        title: "Queue merge",
        author: "octocat",
        isDraft: false,
        reviewDecision: "review-required",
        mergeStateStatus: "blocked",
        checks: "pending",
        mergeable: "mergeable",
    });
});

describe("in-app auto-merge", () => {
    it("queues locally without calling GitHub auto-merge", async () => {
        const session = await connectedWithBlockedPr();

        await session.enablePullRequestAutoMerge("acme/api", 7, "squash", { deleteHeadBranch: false });

        expect(session.getPullRequestPage("acme/api", 7).detail?.autoMergeEnabled).toBe(true);
        expect(session.getPullRequestPage("acme/api", 7).detail?.autoMergeMethod).toBe("squash");
        expect(github.calls).not.toContain("enablePullRequestAutoMerge");
        expect(github.calls).not.toContain("mergePullRequest");
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toContain("squash");
    });

    it("merges once requirements pass", async () => {
        const session = await connectedWithBlockedPr();
        await session.enablePullRequestAutoMerge("acme/api", 7, "squash", { deleteHeadBranch: false });

        github.patchPullRequest(TOKEN, "acme/api", 7, {
            reviewDecision: "approved",
            mergeStateStatus: "clean",
            checks: "success",
        });

        const merged = await session.processQueuedAutoMerges();

        expect(merged).toEqual([{ repository: "acme/api", number: 7 }]);
        expect(github.calls).toContain("mergePullRequest");
        expect(session.getPullRequestPage("acme/api", 7).detail?.state).toBe("merged");
        expect(session.getPullRequestPage("acme/api", 7).detail?.autoMergeEnabled).toBe(false);
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toBe("[]");
    });

    it("merges immediately when the pull request is already ready", async () => {
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 8,
            title: "Ready",
            author: "octocat",
            isDraft: false,
            reviewDecision: "approved",
            mergeStateStatus: "clean",
            checks: "success",
            mergeable: "mergeable",
        });
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);
        await session.loadPullRequest("acme/api", 8);

        await session.enablePullRequestAutoMerge("acme/api", 8, "merge", { deleteHeadBranch: false });

        expect(github.calls).toContain("mergePullRequest");
        expect(github.calls).not.toContain("enablePullRequestAutoMerge");
        expect(session.getPullRequestPage("acme/api", 8).detail?.state).toBe("merged");
    });

    it("cancels a queued merge without talking to GitHub auto-merge", async () => {
        const session = await connectedWithBlockedPr();
        await session.enablePullRequestAutoMerge("acme/api", 7, "squash", { deleteHeadBranch: false });

        await session.disablePullRequestAutoMerge("acme/api", 7);

        expect(session.getPullRequestPage("acme/api", 7).detail?.autoMergeEnabled).toBe(false);
        expect(github.calls).not.toContain("disablePullRequestAutoMerge");
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toBe("[]");
    });

    it("restores the queue after a reload and drops it when the pull request is no longer open", async () => {
        const session = await connectedWithBlockedPr();
        await session.enablePullRequestAutoMerge("acme/api", 7, "squash", { deleteHeadBranch: false });

        const reloaded = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await reloaded.connect(TOKEN);
        await reloaded.setSelectedRepositories(["acme/api"]);
        await reloaded.loadPullRequest("acme/api", 7);

        expect(reloaded.getPullRequestPage("acme/api", 7).detail?.autoMergeEnabled).toBe(true);

        github.patchPullRequest(TOKEN, "acme/api", 7, { state: "closed", isDraft: false });
        await reloaded.processQueuedAutoMerges();

        expect(github.calls).not.toContain("mergePullRequest");
        expect(reloaded.getPullRequestPage("acme/api", 7).detail?.autoMergeEnabled).toBe(false);
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toBe("[]");
    });

    it("queues auto-merge without loading the pull request first", async () => {
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);

        await session.enablePullRequestAutoMerge("acme/api", 7, "squash", { deleteHeadBranch: false });

        expect(github.calls).toContain("getPullRequest");
        expect(github.calls).not.toContain("mergePullRequest");
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toContain("squash");
    });

    it("queues auto-merge for many pull requests and merges the ones that are ready", async () => {
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 8,
            title: "Ready",
            author: "octocat",
            isDraft: false,
            reviewDecision: "approved",
            mergeStateStatus: "clean",
            checks: "success",
            mergeable: "mergeable",
        });
        const session = createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);

        const result = await session.queuePullRequestAutoMerges(
            [
                { repository: "acme/api", number: 7 },
                { repository: "acme/api", number: 8 },
            ],
            "squash",
            { deleteHeadBranch: false },
        );

        expect(result.queued).toBe(2);
        expect(result.merged).toEqual([{ repository: "acme/api", number: 8 }]);
        expect(github.calls).toContain("mergePullRequest");
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).toContain('"number":7');
        expect(store.entries()[queuedAutoMergeStorageKey("quentin")]).not.toContain('"number":8');
    });
});
