import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";
const NOW = "2026-07-27T12:00:00.000Z";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, store });
}

async function connectedSession(selected: Array<string> = ["acme/api", "acme/web"]) {
    const session = newSession();
    await session.connect(TOKEN);
    await session.setSelectedRepositories(selected);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addRepository(TOKEN, "acme/api");
    github.addRepository(TOKEN, "acme/web");
    github.addRepository(TOKEN, "acme/docs");
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 10,
        title: "Current change",
        headRefName: "feature/foo",
        baseRefName: "main",
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/web",
        number: 20,
        title: "Sibling open",
        headRefName: "feature/foo",
        baseRefName: "main",
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/docs",
        number: 30,
        title: "Sibling outside allowlist",
        headRefName: "feature/foo",
        baseRefName: "main",
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/web",
        number: 21,
        title: "Different branch",
        headRefName: "other",
        baseRefName: "main",
        updatedAt: NOW,
    });
});

describe("loadRelatedPullRequests", () => {
    it("loads allowlist siblings with the same head and base, excluding the current repo", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries).toEqual([
            {
                repositories: ["acme/web"],
                headRefName: "feature/foo",
                baseRefName: "main",
            },
        ]);
        expect(session.getRelatedPullRequests("acme/api", 10)).toMatchObject({
            status: "ready",
            searchedAllDiscovered: false,
            items: [{ key: "acme/web#20", title: "Sibling open" }],
        });
    });

    it("does not call GitHub when the allowlist is only the current repository", async () => {
        const session = await connectedSession(["acme/api"]);
        await session.loadPullRequest("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries).toEqual([]);
        expect(session.getRelatedPullRequests("acme/api", 10)).toMatchObject({
            status: "ready",
            items: [],
            searchedAllDiscovered: false,
        });
    });

    it("skips a second load while warm for the same refs", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 10);
        await session.loadRelatedPullRequests("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries).toHaveLength(1);
    });
});

describe("expandRelatedPullRequests", () => {
    it("merges discovered-repo hits that were outside the allowlist", async () => {
        const session = await connectedSession(["acme/api", "acme/web"]);
        await session.refreshRepositories();
        await session.loadPullRequest("acme/api", 10);
        await session.loadRelatedPullRequests("acme/api", 10);

        await session.expandRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries.at(-1)).toEqual({
            repositories: ["acme/docs"],
            headRefName: "feature/foo",
            baseRefName: "main",
        });
        expect(session.getRelatedPullRequests("acme/api", 10).items.map((entry) => entry.key)).toEqual([
            "acme/web#20",
            "acme/docs#30",
        ]);
        expect(session.getRelatedPullRequests("acme/api", 10).searchedAllDiscovered).toBe(true);
    });
});
