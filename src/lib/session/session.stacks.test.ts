import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";
import type { PullRequestDetail } from "#/lib/session/types.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";
import { replaceStackPreferences } from "#/lib/stack-preferences.ts";

const TOKEN = "test_cred_valid";
const VIEWER = "quentin";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
}

async function connectedSession(selected: Array<string> = ["acme/api"]) {
    const session = newSession();
    await session.connect(TOKEN);
    await session.setSelectedRepositories(selected);
    return session;
}

function attachGithubStack(layers: Array<PullRequestDetail>, baseRefName = "dev") {
    const githubStackPullRequests = layers;
    for (const [index, layer] of layers.entries()) {
        github.patchPullRequest(TOKEN, layer.repository, layer.number, {
            githubStack: {
                number: 1,
                size: layers.length,
                position: index + 1,
                baseRefName,
            },
            githubStackPullRequests,
        });
    }
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: VIEWER });
    replaceStackPreferences({ enabled: true, hideClosed: false });
    const bottom = github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 148,
        headRefName: "feat-a",
        baseRefName: "dev",
        state: "merged",
        mergedAt: new Date().toISOString(),
        githubStack: { number: 1, size: 2, position: 1, baseRefName: "dev" },
    });
    const top = github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 195,
        headRefName: "feat-b",
        baseRefName: "feat-a",
        reviewRequests: [VIEWER],
        githubStack: { number: 1, size: 2, position: 2, baseRefName: "dev" },
    });
    attachGithubStack([bottom, top]);
});

describe("pull request stacks", () => {
    it("resolves a GitHub stack after the pull request is loaded", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        expect(session.getPullRequestStack("acme/api", 195)).toMatchObject({ status: "loading", stack: null });

        await session.loadPullRequest("acme/api", 195);

        expect(session.getPullRequestStack("acme/api", 195).stack).toMatchObject({ position: 2, total: 2 });
    });

    it("does not treat branch-named siblings as a stack", async () => {
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 200,
            headRefName: "feat-c",
            baseRefName: "dev",
            reviewRequests: [VIEWER],
        });
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 201,
            headRefName: "feat-d",
            baseRefName: "dev",
            reviewRequests: [VIEWER],
        });

        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 200);
        await session.loadPullRequest("acme/api", 201);

        expect(session.getPullRequestStack("acme/api", 200).stack).toBeNull();
        expect(session.getPullRequestStack("acme/api", 201).stack).toBeNull();
    });

    it("does not fall back to Graphite stack comments", async () => {
        const graphiteComment = `* **#329** Graphite 👈
* **#327** Graphite
* **#310** Graphite
* \`dev\`

This stack of pull requests is managed by Graphite.`;

        for (const number of [310, 327, 329]) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                title: number === 329 ? "cg" : `Pull request ${number}`,
                headRefName: `branch-${number}`,
                baseRefName: "dev",
                state: "merged",
            });
        }

        github.addTimelineItem(TOKEN, "acme/api", 329, {
            kind: "comment",
            id: "comment-graphite",
            databaseId: 1,
            author: "stacker",
            authorAvatarUrl: null,
            body: graphiteComment,
            createdAt: new Date().toISOString(),
            url: "https://github.com/acme/api/pull/329#issuecomment-1",
            lastEditedAt: null,
            editor: null,
            editCount: 0,
            edits: [],
            reactionGroups: [],
        });

        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 329);

        expect(session.getPullRequestStack("acme/api", 329).stack).toBeNull();
    });

    it("merges this pull request and GitHub stack layers below it", async () => {
        const next = github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 196,
            headRefName: "feat-c",
            baseRefName: "feat-b",
            reviewDecision: "approved",
        });
        github.patchPullRequest(TOKEN, "acme/api", 195, {
            reviewDecision: "approved",
            mergeable: "mergeable",
            mergeStateStatus: "clean",
        });
        const bottom = await github.getPullRequest(TOKEN, "acme/api", 148);
        const middle = await github.getPullRequest(TOKEN, "acme/api", 195);
        attachGithubStack([bottom, middle, next]);

        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 196);

        await session.mergePullRequestStack("acme/api", 196, "squash");

        const mergedMiddle = await github.getPullRequest(TOKEN, "acme/api", 195);
        const mergedTop = await github.getPullRequest(TOKEN, "acme/api", 196);
        expect(mergedMiddle.state).toBe("merged");
        expect(mergedTop.state).toBe("merged");
    });

    it("refuses to merge a stack when a downstack pull request is blocked", async () => {
        const next = github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 196,
            headRefName: "feat-c",
            baseRefName: "feat-b",
            reviewDecision: "approved",
        });
        github.patchPullRequest(TOKEN, "acme/api", 195, {
            reviewDecision: "approved",
            mergeable: "conflicting",
            mergeStateStatus: "dirty",
        });
        const bottom = await github.getPullRequest(TOKEN, "acme/api", 148);
        const middle = await github.getPullRequest(TOKEN, "acme/api", 195);
        attachGithubStack([bottom, middle, next]);

        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 196);

        await expect(session.mergePullRequestStack("acme/api", 196, "squash")).rejects.toMatchObject({
            message: expect.stringContaining("#195"),
        });
    });
});
