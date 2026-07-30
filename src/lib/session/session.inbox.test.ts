import { beforeEach, describe, expect, it } from "vitest";

import type { EasyReviewSession } from "#/lib/session/session.ts";
import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { INBOX_SECTION_LOAD_SIZE } from "#/lib/session/inbox-sections.ts";
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

function sectionFetchCalls() {
    return github.calls.filter((call) => call === "fetchSectionPullRequests").length;
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
    it("loads each visible section from GitHub search", async () => {
        const session = await connectedSession(["acme/api"]);

        await session.loadInbox();

        expect(sectionFetchCalls()).toBeGreaterThan(0);
        expect(session.state.state.inbox.pullRequests.map((entry) => entry.key).sort()).toEqual([
            "acme/api#1",
            "acme/api#2",
        ]);
    });

    it("does not call GitHub at all while nothing is selected", async () => {
        const session = await connectedSession([]);

        await session.loadInbox();

        expect(sectionFetchCalls()).toBe(0);
        expect(session.state.state.inbox).toMatchObject({ status: "ready", pullRequests: [] });
    });

    it("assigns pull requests to the matching sections", async () => {
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
        const callsAfterLoad = sectionFetchCalls();

        await session.setSelectedRepositories(["acme/web"]);

        expect(sectionOf(session, "needs-your-review")?.pullRequests.map((entry) => entry.key)).toEqual(["acme/web#7"]);
        expect(sectionFetchCalls()).toBe(callsAfterLoad);
    });

    it("reports an error when there is nothing cached to fall back on", async () => {
        const session = newSession();
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);
        github.failAllWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.loadInbox();

        expect(session.state.state.inbox.status).toBe("error");
        expect(session.state.state.inbox.error?.kind).toBe("rate-limited");
    });

    it("keeps showing cached rows when a refresh fails", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        github.failAllWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.refreshInbox();

        expect(session.state.state.inbox.status).toBe("ready");
        expect(session.state.state.inbox.pullRequests.length).toBeGreaterThan(0);
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
        expect(sectionFetchCalls()).toBeGreaterThan(0);
    });

    it("does not call GitHub again for a warm cache", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        await session.loadInbox();

        expect(sectionFetchCalls()).toBe(callsAfterFirstLoad);
    });

    it("refetches once the allowlist changed", async () => {
        const session = await connectedSession(["acme/api"]);
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        await session.setSelectedRepositories(["acme/api", "acme/web"]);
        await session.loadInbox();

        expect(sectionFetchCalls()).toBeGreaterThan(callsAfterFirstLoad);
    });

    it("revalidates on demand, which is what tab focus and manual refresh use", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        await session.revalidateInbox();

        expect(sectionFetchCalls()).toBeGreaterThan(callsAfterFirstLoad);
    });

    it("never fires two overlapping revalidations", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        const release = github.deferNext();
        const first = session.revalidateInbox();
        await session.revalidateInbox();
        release();
        await first;

        expect(sectionFetchCalls()).toBeGreaterThan(callsAfterFirstLoad);
    });

    it("skips background revalidation when the inbox was just refreshed", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        await session.revalidateInbox({ background: true });

        expect(sectionFetchCalls()).toBe(callsAfterFirstLoad);
    });

    it("throws away a load that lands after the user signed out", async () => {
        const session = await connectedSession();

        const release = github.deferNext();
        const pending = session.loadInbox();
        await session.disconnect();
        release();
        await pending;

        expect(session.state.state.inbox.pullRequests).toEqual([]);
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

    it("loads section data when a section is opened, but not when it is closed", async () => {
        const session = await connectedSession();
        await session.loadInbox();
        const callsAfterFirstLoad = sectionFetchCalls();

        await session.toggleSection("drafts");
        const callsAfterOpen = sectionFetchCalls();
        await session.toggleSection("drafts");

        expect(callsAfterOpen).toBeGreaterThan(callsAfterFirstLoad);
        expect(sectionFetchCalls()).toBe(callsAfterOpen);
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

describe("load more", () => {
    it("paginates section pull requests in fake GitHub", async () => {
        for (let number = 3; number <= 14; number++) {
            github.addPullRequest(TOKEN, { repository: "acme/api", number, state: "merged" });
        }

        const first = await github.fetchSectionPullRequests(TOKEN, {
            query: "is:pr is:merged",
            repositories: ["acme/api"],
            limit: INBOX_SECTION_LOAD_SIZE,
        });
        expect(first.pageInfo.hasNextPage).toBe(true);

        const second = await github.fetchSectionPullRequests(TOKEN, {
            query: "is:pr is:merged",
            repositories: ["acme/api"],
            limit: INBOX_SECTION_LOAD_SIZE,
            after: first.pageInfo.endCursor,
        });
        expect(second.pullRequests.length).toBeGreaterThan(0);
    });

    it("loads ten rows and the full count for merged sections", async () => {
        const session = await connectedSession(["acme/api"]);
        for (let number = 3; number <= 14; number++) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                state: "merged",
                mergedAt: new Date().toISOString(),
            });
        }

        await session.loadInbox();
        await session.setSectionHidden("merging-and-recently-merged", false);

        const section = sectionOf(session, "merging-and-recently-merged");
        expect(section?.count).toBe(12);
        expect(section?.pullRequests.length).toBe(INBOX_SECTION_LOAD_SIZE);
        expect(session.canLoadMoreInboxSection("merging-and-recently-merged")).toBe(true);
    });

    it("loads more rows for one section", async () => {
        const session = await connectedSession(["acme/api"]);
        for (let number = 3; number <= 14; number++) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                state: "merged",
                mergedAt: new Date().toISOString(),
            });
        }

        await session.loadInbox();
        await session.setSectionHidden("merging-and-recently-merged", false);
        await session.loadMoreInboxSection("merging-and-recently-merged");

        const section = sectionOf(session, "merging-and-recently-merged");
        expect(section?.pullRequests.length).toBe(12);
        expect(session.canLoadMoreInboxSection("merging-and-recently-merged")).toBe(false);
    });
});
