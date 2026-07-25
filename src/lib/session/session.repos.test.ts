import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, store });
}

async function connectedSession() {
    const session = newSession();
    await session.connect(TOKEN);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addRepository(TOKEN, "quentin/easy-review", { pushedAt: "2026-07-01T00:00:00.000Z" });
    github.addRepository(TOKEN, "acme/api", { isPrivate: true });
    github.addRepository(TOKEN, "acme/legacy", { isArchived: true });
});

describe("discovery", () => {
    it("lists every repository the token can see", async () => {
        const session = await connectedSession();

        await session.refreshRepositories();

        expect(session.state.state.repos.available.map((repository) => repository.nameWithOwner)).toEqual([
            "quentin/easy-review",
            "acme/api",
            "acme/legacy",
        ]);
        expect(session.state.state.repos).toMatchObject({ status: "ready", refreshing: false, error: null });
    });

    it("refuses to call GitHub without a token", async () => {
        const session = newSession();
        await session.restore();

        await session.refreshRepositories();

        expect(session.state.state.repos).toMatchObject({ status: "error" });
        expect(session.state.state.repos.error?.kind).toBe("unauthorized");
        expect(github.calls).toEqual([]);
    });

    it("surfaces a rate-limited discovery without losing the cached list", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached."));

        await session.refreshRepositories();

        expect(session.state.state.repos.status).toBe("ready");
        expect(session.state.state.repos.available).toHaveLength(3);
        expect(session.state.state.repos.error?.kind).toBe("rate-limited");
    });

    it("paints the cached list on the next visit without calling GitHub again", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        const callsAfterFirstLoad = github.calls.length;

        const reloaded = newSession();
        await reloaded.restore();
        await reloaded.loadRepositories();

        expect(reloaded.state.state.repos.available).toHaveLength(3);
        expect(github.calls).toHaveLength(callsAfterFirstLoad + 1); // only the getViewer of restore
    });
});

describe("allowlist", () => {
    it("starts empty so nothing is queried until the user opts in", async () => {
        const session = await connectedSession();

        expect(session.state.state.repos.selected).toEqual([]);
        expect(session.getSelectedRepositories()).toEqual([]);
    });

    it("treats only the selected repositories as Inbox sources", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();

        await session.toggleRepository("acme/api", true);
        await session.toggleRepository("quentin/easy-review", true);
        await session.toggleRepository("acme/api", false);

        expect(session.state.state.repos.selected).toEqual(["quentin/easy-review"]);
        expect(session.getSelectedRepositories().map((repository) => repository.nameWithOwner)).toEqual([
            "quentin/easy-review",
        ]);
    });

    it("never records the same repository twice", async () => {
        const session = await connectedSession();

        await session.setSelectedRepositories(["acme/api", "acme/api"]);

        expect(session.state.state.repos.selected).toEqual(["acme/api"]);
    });

    it("keeps the selection across a reload", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        await session.setSelectedRepositories(["acme/api"]);

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.state.state.repos.selected).toEqual(["acme/api"]);
        expect(reloaded.getSelectedRepositories()[0]).toMatchObject({ nameWithOwner: "acme/api", isPrivate: true });
    });

    it("still knows a selected repository before the list has been fetched", async () => {
        const session = await connectedSession();
        await session.setSelectedRepositories(["acme/api"]);

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.getSelectedRepositories()).toEqual([
            {
                nameWithOwner: "acme/api",
                owner: "acme",
                name: "api",
                isPrivate: false,
                isArchived: false,
                pushedAt: null,
            },
        ]);
    });
});

describe("switching account", () => {
    it("does not show the previous account's repositories after replacing the token", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        await session.setSelectedRepositories(["acme/api"]);

        github.addAccount("github_pat_other", { login: "octocat" });
        github.addRepository("github_pat_other", "octocat/hello");
        await session.connect("github_pat_other");

        expect(session.state.state.repos).toMatchObject({ status: "idle", available: [], selected: [] });
    });

    it("keeps the selection when the same account replaces its token", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        await session.setSelectedRepositories(["acme/api"]);

        github.addAccount("github_pat_rotated", { login: "quentin" });
        await session.connect("github_pat_rotated");

        expect(session.state.state.repos.selected).toEqual(["acme/api"]);
    });
});

describe("disconnect", () => {
    it("forgets which repositories this person reviews", async () => {
        const session = await connectedSession();
        await session.refreshRepositories();
        await session.setSelectedRepositories(["acme/api"]);

        await session.disconnect();

        expect(session.state.state.repos).toMatchObject({ status: "idle", available: [], selected: [] });
        expect(store.entries()).toEqual({});
    });
});
