import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const TOKEN = "test_cred_valid";
const VIEWER = "quentin";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
}

async function connectedSession() {
    const session = newSession();
    await session.connect(TOKEN);
    await session.setSelectedRepositories(["acme/api"]);
    return session;
}

function detailCalls() {
    return github.calls.filter((call) => call === "getPullRequest").length;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: VIEWER });
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 1,
        title: "Retry failed webhooks",
        body: "## Why\n\nWebhooks were dropped on the floor.",
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: ["hubot"],
        checkRuns: [{ name: "build", state: "failure", url: "https://ci.example/build", summary: "Failing after 1m" }],
        mergeable: "conflicting",
    });
});

describe("loading a pull request", () => {
    it("fetches the full overview for a pull request in the Inbox", async () => {
        const session = await connectedSession();

        await session.loadPullRequest("acme/api", 1);

        const page = session.getPullRequestPage("acme/api", 1);
        expect(page.status).toBe("ready");
        expect(page.detail).toMatchObject({
            title: "Retry failed webhooks",
            body: "## Why\n\nWebhooks were dropped on the floor.",
            labels: [{ name: "bug", color: "d73a4a" }],
            assignees: ["hubot"],
            mergeable: "conflicting",
        });
        expect(page.detail?.checkRuns).toHaveLength(1);
    });

    it("opens a pull request that was never in the Inbox", async () => {
        const session = await connectedSession();
        github.addPullRequest(TOKEN, { repository: "other/repo", number: 9 });

        await session.loadPullRequest("other/repo", 9);

        expect(session.getPullRequestPage("other/repo", 9).detail?.key).toBe("other/repo#9");
    });

    it("paints the Inbox row while the full overview is still loading", async () => {
        const session = await connectedSession();
        // Only sections showing rows load them: put the PR in one that is open by default.
        await github.requestReviewers(TOKEN, "acme/api", 1, [VIEWER]);
        await session.loadInbox();

        const release = github.deferNext();
        const pending = session.loadPullRequest("acme/api", 1);

        const page = session.getPullRequestPage("acme/api", 1);
        expect(page.status).toBe("loading");
        expect(page.detail).toBeNull();
        expect(page.summary?.title).toBe("Retry failed webhooks");

        release();
        await pending;
    });

    it("refuses to fetch without a credential", async () => {
        const session = newSession();
        await session.restore();

        await session.loadPullRequest("acme/api", 1);

        expect(session.getPullRequestPage("acme/api", 1).error?.kind).toBe("unauthorized");
        expect(detailCalls()).toBe(0);
    });
});

describe("errors", () => {
    it("reports a pull request this session cannot see", async () => {
        const session = await connectedSession();

        await session.loadPullRequest("acme/api", 404);

        const page = session.getPullRequestPage("acme/api", 404);
        expect(page.status).toBe("error");
        expect(page.error?.kind).toBe("not-found");
    });

    it("keeps showing the overview when a refresh fails", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 1);
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.refreshPullRequest("acme/api", 1);

        const page = session.getPullRequestPage("acme/api", 1);
        expect(page.status).toBe("ready");
        expect(page.detail?.title).toBe("Retry failed webhooks");
        expect(page.error?.kind).toBe("rate-limited");
    });

    it("keeps one failing pull request from touching another", async () => {
        const session = await connectedSession();

        await session.loadPullRequest("acme/api", 404);
        await session.loadPullRequest("acme/api", 1);

        expect(session.getPullRequestPage("acme/api", 404).status).toBe("error");
        expect(session.getPullRequestPage("acme/api", 1).status).toBe("ready");
    });
});

describe("cache and revalidation", () => {
    it("does not call GitHub again for a pull request this tab already opened", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 1);

        await session.loadPullRequest("acme/api", 1);

        expect(detailCalls()).toBe(1);
    });

    it("revalidates on demand, which is what tab focus and manual refresh use", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 1);

        await session.revalidatePullRequest("acme/api", 1);

        expect(detailCalls()).toBe(2);
    });

    it("never fires two overlapping revalidations", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 1);

        const release = github.deferNext();
        const first = session.revalidatePullRequest("acme/api", 1);
        await session.revalidatePullRequest("acme/api", 1);
        release();
        await first;

        expect(detailCalls()).toBe(2);
    });

    it("throws away an overview that lands after the user signed out", async () => {
        const session = await connectedSession();

        const release = github.deferNext();
        const pending = session.loadPullRequest("acme/api", 1);
        await session.disconnect();
        release();
        await pending;

        expect(session.getPullRequestPage("acme/api", 1).detail).toBeNull();
    });
});

describe("stacking onto the pull request below", () => {
    function addChain() {
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 10,
            author: VIEWER,
            headRefName: "feat/list",
            baseRefName: "main",
        });
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 11,
            author: VIEWER,
            headRefName: "feat/view",
            baseRefName: "feat/list",
        });
    }

    it("finds the open pull request whose branch is this one's base", async () => {
        addChain();

        const lookup = await github.findPullRequestsBelow(TOKEN, "acme/api", 11, "feat/list");

        expect(lookup.candidates.map((candidate) => candidate.number)).toEqual([10]);
        expect(lookup.candidates[0]?.stack).toBeNull();
    });

    it("creates a stack of the two, the one below at the bottom", async () => {
        addChain();
        const session = await connectedSession();

        await session.stackPullRequest("acme/api", 11, {
            kind: "create",
            below: (await github.findPullRequestsBelow(TOKEN, "acme/api", 11, "feat/list")).candidates[0]!,
            pullRequests: [10, 11],
        });

        const page = session.getPullRequestPage("acme/api", 11);
        expect(page.detail?.githubStack).toMatchObject({ size: 2, position: 2, baseRefName: "main" });
        expect(page.detail?.githubStackPullRequests.map((layer) => layer.number)).toEqual([10, 11]);
    });

    it("adds this pull request on top of the stack the one below tops", async () => {
        addChain();
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 12,
            author: VIEWER,
            headRefName: "feat/edit",
            baseRefName: "feat/view",
        });
        await github.createPullRequestStack(TOKEN, "acme/api", [10, 11]);
        const below = (await github.findPullRequestsBelow(TOKEN, "acme/api", 12, "feat/view")).candidates[0]!;
        expect(below.stack).toMatchObject({ size: 2, position: 2 });
        const session = await connectedSession();

        await session.stackPullRequest("acme/api", 12, {
            kind: "add",
            below,
            stackNumber: below.stack!.number,
            pullRequests: [12],
        });

        expect(session.getPullRequestPage("acme/api", 12).detail?.githubStack).toMatchObject({
            size: 3,
            position: 3,
        });
    });

    it("reports GitHub refusing the stack", async () => {
        addChain();
        const session = await connectedSession();

        await expect(
            session.stackPullRequest("acme/api", 11, {
                kind: "create",
                below: (await github.findPullRequestsBelow(TOKEN, "acme/api", 11, "feat/list")).candidates[0]!,
                pullRequests: [11, 10],
            }),
        ).rejects.toThrow("can't form a valid stack");
    });
});
