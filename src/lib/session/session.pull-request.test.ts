import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";
const VIEWER = "quentin";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, store });
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

    it("refuses to fetch without a token", async () => {
        const session = newSession();
        await session.restore();

        await session.loadPullRequest("acme/api", 1);

        expect(session.getPullRequestPage("acme/api", 1).error?.kind).toBe("unauthorized");
        expect(detailCalls()).toBe(0);
    });
});

describe("errors", () => {
    it("reports a pull request this token cannot see", async () => {
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
