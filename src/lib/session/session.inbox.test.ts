import { beforeEach, describe, expect, it } from "vitest";

import type { EasyReviewSession } from "#/lib/session/session.ts";
import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "test_cred_valid";
const VIEWER = "quentin";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, store });
}

async function connectedSession(selected: Array<string> = ["acme/api"]) {
    const session = newSession();
    await session.connect(TOKEN);
    await session.setSelectedRepositories(selected);
    return session;
}

function sectionOf(session: EasyReviewSession, id: string) {
    return session.getInboxSections().find((section) => section.id === id);
}

function inboxCalls() {
    return github.calls.filter((call) => call === "listPullRequests").length;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: VIEWER });
    github.addPullRequest(TOKEN, { repository: "acme/api", number: 1, reviewRequests: [VIEWER] });
    github.addPullRequest(TOKEN, { repository: "acme/api", number: 2, author: VIEWER });
    github.addPullRequest(TOKEN, { repository: "acme/web", number: 7, reviewRequests: [VIEWER] });
});

describe("loading", () => {
    it("only queries the repositories in the allowlist", async () => {
        const session = await connectedSession(["acme/api"]);

        await session.loadInbox();

        expect(github.pullRequestQueries).toEqual([["acme/api"]]);
        expect(session.state.state.inbox.pullRequests.map((entry) => entry.key)).toEqual(["acme/api#1", "acme/api#2"]);
    });

    it("does not call GitHub at all while nothing is selected", async () => {
        const session = await connectedSession([]);

        await session.loadInbox();

        expect(inboxCalls()).toBe(0);
        expect(session.state.state.inbox).toMatchObject({ status: "ready", pullRequests: [] });
    });

    it("groups pull requests into the default sections", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        await session.setSectionHidden("drafts", false);

        expect(sectionOf(session, "needs-your-review")?.pullRequests.map((entry) => entry.key)).toEqual(["acme/api#1"]);
        expect(sectionOf(session, "waiting-for-reviewers-me")?.pullRequests.map((entry) => entry.key)).toEqual([
            "acme/api#2",
        ]);
        expect(sectionOf(session, "drafts")?.pullRequests).toEqual([]);
    });

    it("hides rows from a repository the user just deselected, without refetching", async () => {
        const session = await connectedSession(["acme/api", "acme/web"]);
        await session.loadInbox();
        const callsAfterLoad = inboxCalls();

        await session.setSelectedRepositories(["acme/web"]);

        expect(sectionOf(session, "needs-your-review")?.pullRequests.map((entry) => entry.key)).toEqual(["acme/web#7"]);
        expect(inboxCalls()).toBe(callsAfterLoad);
    });

    it("reports an error when there is nothing cached to fall back on", async () => {
        const session = await connectedSession();
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.loadInbox();

        expect(session.state.state.inbox.status).toBe("error");
        expect(session.state.state.inbox.error?.kind).toBe("rate-limited");
    });

    it("keeps showing cached rows when a refresh fails", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.refreshInbox();

        expect(session.state.state.inbox.status).toBe("ready");
        expect(session.state.state.inbox.pullRequests).toHaveLength(2);
        expect(session.state.state.inbox.error?.kind).toBe("rate-limited");
    });
});

describe("cache and revalidation", () => {
    it("paints the previous visit's rows before touching the network", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        const reloaded = newSession();
        await reloaded.connect(TOKEN);

        expect(reloaded.state.state.inbox.status).toBe("ready");
        expect(reloaded.state.state.inbox.pullRequests).toHaveLength(2);
        expect(inboxCalls()).toBe(1);
    });

    it("does not call GitHub again for a warm cache", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        await session.loadInbox();

        expect(inboxCalls()).toBe(1);
    });

    it("refetches once the allowlist changed", async () => {
        const session = await connectedSession(["acme/api"]);
        await session.loadInbox();

        await session.setSelectedRepositories(["acme/api", "acme/web"]);
        await session.loadInbox();

        expect(github.pullRequestQueries.at(-1)).toEqual(["acme/api", "acme/web"]);
        expect(inboxCalls()).toBe(2);
    });

    it("revalidates on demand, which is what tab focus and manual refresh use", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        await session.revalidateInbox();

        expect(inboxCalls()).toBe(2);
    });

    it("never fires two overlapping revalidations", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        const release = github.deferNext();
        const first = session.revalidateInbox();
        await session.revalidateInbox();
        release();
        await first;

        expect(inboxCalls()).toBe(2);
    });

    it("throws away a load that lands after the user signed out", async () => {
        const session = await connectedSession();

        const release = github.deferNext();
        const pending = session.loadInbox();
        await session.disconnect();
        release();
        await pending;

        expect(session.state.state.inbox.pullRequests).toEqual([]);
        expect(await store.get("inbox:cache")).toBeNull();
    });
});

describe("sections", () => {
    it("opens with the sections that need attention by default", async () => {
        const session = await connectedSession();

        expect(session.state.state.inbox.expandedSections).toEqual([
            "needs-your-review",
            "returned-to-you",
            "waiting-for-reviewers-me",
            "approved",
        ]);
    });

    it("revalidates when a section is opened, but not when it is closed", async () => {
        const session = await connectedSession();
        await session.loadInbox();

        await session.toggleSection("drafts");
        const callsAfterOpen = inboxCalls();
        await session.toggleSection("drafts");

        expect(callsAfterOpen).toBe(2);
        expect(inboxCalls()).toBe(2);
    });

    it("keeps section expand state in memory for the session, not across reload", async () => {
        const session = await connectedSession();
        await session.toggleSection("drafts");

        const reloaded = newSession();
        await reloaded.connect(TOKEN);

        expect(reloaded.state.state.inbox.expandedSections).not.toContain("drafts");
        expect(reloaded.state.state.inbox.expandedSections).toEqual([
            "needs-your-review",
            "returned-to-you",
            "waiting-for-reviewers-me",
            "approved",
        ]);
    });
});
