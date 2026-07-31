import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

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

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: VIEWER });
    replaceStackPreferences({ enabled: true, hideClosed: false });
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 148,
        headRefName: "feat-a",
        baseRefName: "dev",
        state: "merged",
        mergedAt: new Date().toISOString(),
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 195,
        headRefName: "feat-b",
        baseRefName: "feat-a",
        reviewRequests: [VIEWER],
    });
});

describe("pull request stacks", () => {
    it("waits for the repo index before resolving a stack", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        await session.setSectionHidden("merging-and-recently-merged", false);

        session.state.setState((previous) => ({
            ...previous,
            repoStackIndices: {},
        }));

        expect(session.getPullRequestStack("acme/api", 195)).toMatchObject({ status: "loading", stack: null });

        await session.loadRepoStackIndex("acme/api");

        expect(session.getPullRequestStack("acme/api", 195).stack).toMatchObject({ position: 2, total: 2 });
    });

    it("does not badge a pull request whose base is trunk alongside unrelated siblings", async () => {
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
        await session.loadInbox();

        expect(session.getPullRequestStack("acme/api", 200).stack).toBeNull();
        expect(session.getPullRequestStack("acme/api", 201).stack).toBeNull();
    });

    it("falls back to the Graphite stack comment when branch names no longer chain", async () => {
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
        await session.loadRepoStackIndex("acme/api");
        await session.loadGraphiteStack("acme/api", 329);

        expect(session.getPullRequestStack("acme/api", 329).stack).toMatchObject({
            position: 3,
            total: 3,
            trunkRefName: "dev",
        });
        expect(session.getPullRequestStack("acme/api", 329).stack?.pullRequests.map((entry) => entry.number)).toEqual([
            310, 327, 329,
        ]);
        expect(session.getPullRequestStack("acme/api", 329).stack?.pullRequests.at(-1)?.title).toBe("cg");

        github.patchPullRequest(TOKEN, "acme/api", 329, {
            title: "feat: add invoice badge in patient search",
        });
        await session.revalidatePullRequest("acme/api", 329);

        expect(session.getPullRequestStack("acme/api", 329).stack?.pullRequests.at(-1)?.title).toBe(
            "feat: add invoice badge in patient search",
        );
    });

    it("merges open pull requests in a stack bottom-up", async () => {
        github.addPullRequest(TOKEN, {
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

        const session = await connectedSession();
        await session.loadInbox();
        await session.loadRepoStackIndex("acme/api");

        await session.mergePullRequestStack("acme/api", 196, "squash");

        const mergedBottom = await github.getPullRequest(TOKEN, "acme/api", 195);
        const mergedTop = await github.getPullRequest(TOKEN, "acme/api", 196);
        expect(mergedBottom.state).toBe("merged");
        expect(mergedTop.state).toBe("merged");
    });

    it("refuses to merge a stack when a downstack pull request is blocked", async () => {
        github.addPullRequest(TOKEN, {
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

        const session = await connectedSession();
        await session.loadInbox();
        await session.loadRepoStackIndex("acme/api");

        await expect(session.mergePullRequestStack("acme/api", 196, "squash")).rejects.toMatchObject({
            message: expect.stringContaining("#195"),
        });
    });
});
