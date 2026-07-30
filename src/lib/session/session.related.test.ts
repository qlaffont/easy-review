import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "test_cred_valid";
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
        createdAt: NOW,
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/web",
        number: 20,
        title: "Sibling open",
        headRefName: "feature/foo",
        baseRefName: "main",
        createdAt: NOW,
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/docs",
        number: 30,
        title: "Sibling outside allowlist",
        headRefName: "feature/foo",
        baseRefName: "main",
        createdAt: NOW,
        updatedAt: NOW,
    });
    github.addPullRequest(TOKEN, {
        repository: "acme/web",
        number: 21,
        title: "Different branch",
        headRefName: "other",
        baseRefName: "main",
        createdAt: NOW,
        updatedAt: NOW,
    });
});

describe("loadRelatedPullRequests", () => {
    it("searches all discovered repos and filters by the focal creation window", async () => {
        const session = await connectedSession(["acme/api", "acme/web"]);
        await session.refreshRepositories();
        await session.loadPullRequest("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries).toEqual([
            {
                repositories: ["acme/web", "acme/docs"],
                headRefName: "feature/foo",
                baseRefName: "main",
            },
        ]);
        expect(session.getRelatedPullRequests("acme/api", 10)).toMatchObject({
            status: "ready",
            items: [
                { key: "acme/web#20", title: "Sibling open" },
                { key: "acme/docs#30", title: "Sibling outside allowlist" },
            ],
        });
    });

    it("drops related PRs created outside the 7-day window", async () => {
        github.addPullRequest(TOKEN, {
            repository: "acme/web",
            number: 22,
            title: "Old deploy",
            headRefName: "feature/foo",
            baseRefName: "main",
            createdAt: "2026-07-09T00:00:00.000Z",
            updatedAt: "2026-07-09T00:00:00.000Z",
        });
        github.addPullRequest(TOKEN, {
            repository: "acme/docs",
            number: 31,
            title: "Old sibling",
            headRefName: "feature/foo",
            baseRefName: "main",
            createdAt: "2026-07-09T00:00:00.000Z",
            updatedAt: "2026-07-09T00:00:00.000Z",
        });

        const session = await connectedSession();
        await session.refreshRepositories();
        await session.loadPullRequest("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(session.getRelatedPullRequests("acme/api", 10).items.map((entry) => entry.key)).toEqual([
            "acme/web#20",
            "acme/docs#30",
        ]);
    });

    it("does not call GitHub when no other discovered repositories exist", async () => {
        const isolatedGithub = createFakeGithub();
        const isolatedStore = createMemoryStore();
        isolatedGithub.addAccount(TOKEN, { login: "quentin" });
        isolatedGithub.addRepository(TOKEN, "acme/api");
        isolatedGithub.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 10,
            title: "Current change",
            headRefName: "feature/foo",
            baseRefName: "main",
            createdAt: NOW,
            updatedAt: NOW,
        });

        const session = createEasyReviewSession({ github: isolatedGithub, store: isolatedStore });
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);
        await session.refreshRepositories();
        await session.loadPullRequest("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(isolatedGithub.relatedPullRequestQueries).toEqual([]);
        expect(session.getRelatedPullRequests("acme/api", 10)).toMatchObject({
            status: "ready",
            items: [],
        });
    });

    it("skips a second load while warm for the same refs", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        await session.loadPullRequest("acme/api", 10);
        await session.loadRelatedPullRequests("acme/api", 10);

        await session.loadRelatedPullRequests("acme/api", 10);

        expect(github.relatedPullRequestQueries).toHaveLength(1);
    });
});
