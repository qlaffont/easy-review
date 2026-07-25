import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const VALID_TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, store });
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
});

describe("auth state", () => {
    it("starts as restoring so the UI can wait for browser storage", () => {
        const session = newSession();

        expect(session.state.state.auth.status).toBe("restoring");
    });

    it("settles as unauthenticated without calling GitHub when no token is stored", async () => {
        const session = newSession();

        await session.restore();

        expect(session.state.state.auth).toMatchObject({
            status: "unauthenticated",
            viewer: null,
            tokenStored: false,
            error: null,
        });
        expect(github.calls).toEqual([]);
    });
});

describe("connect", () => {
    it("authenticates and persists a token GitHub accepts", async () => {
        github.addAccount(VALID_TOKEN, { login: "quentin" });
        const session = newSession();

        await session.connect(VALID_TOKEN);

        expect(session.state.state.auth).toMatchObject({
            status: "authenticated",
            tokenStored: true,
            error: null,
        });
        expect(session.state.state.auth.viewer?.login).toBe("quentin");
        expect(Object.values(store.entries())).toContain(VALID_TOKEN);
    });

    it("trims pasted whitespace", async () => {
        github.addAccount(VALID_TOKEN);
        const session = newSession();

        await session.connect(`  ${VALID_TOKEN}\n`);

        expect(session.state.state.auth.status).toBe("authenticated");
    });

    it("rejects an empty paste without calling GitHub", async () => {
        const session = newSession();

        await session.connect("   ");

        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
        expect(github.calls).toEqual([]);
    });

    it("explains an unauthorized token and stores nothing", async () => {
        const session = newSession();

        await session.connect("github_pat_revoked");

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", tokenStored: false });
        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
        expect(store.entries()).toEqual({});
    });

    it("explains a rate-limited response and keeps the retry time", async () => {
        const retryAt = new Date("2026-01-01T10:00:00.000Z").toISOString();
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached.", { retryAt }));
        const session = newSession();

        await session.connect(VALID_TOKEN);

        expect(session.state.state.auth.error).toMatchObject({ kind: "rate-limited", retryAt });
        expect(session.state.state.auth.status).toBe("unauthenticated");
    });

    it("replaces a working token with another one", async () => {
        github.addAccount(VALID_TOKEN, { login: "quentin" });
        github.addAccount("github_pat_other", { login: "octocat" });
        const session = newSession();
        await session.connect(VALID_TOKEN);

        await session.connect("github_pat_other");

        expect(session.state.state.auth.viewer?.login).toBe("octocat");
        expect(Object.values(store.entries())).toEqual(["github_pat_other"]);
    });

    it("keeps the working session when a replacement token is rejected", async () => {
        github.addAccount(VALID_TOKEN, { login: "quentin" });
        const session = newSession();
        await session.connect(VALID_TOKEN);

        await session.connect("github_pat_typo");

        expect(session.state.state.auth.status).toBe("authenticated");
        expect(session.state.state.auth.viewer?.login).toBe("quentin");
        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
        expect(Object.values(store.entries())).toEqual([VALID_TOKEN]);
    });
});

describe("overlapping credential checks", () => {
    it("keeps the result of the most recent paste, whatever order GitHub replies in", async () => {
        github.addAccount("github_pat_a", { login: "first" });
        github.addAccount("github_pat_b", { login: "second" });
        const session = newSession();

        const release = github.deferNext();
        const slow = session.connect("github_pat_a");
        await session.connect("github_pat_b");
        release();
        await slow;

        expect(session.state.state.auth.viewer?.login).toBe("second");
        expect(Object.values(store.entries())).toEqual(["github_pat_b"]);
    });

    it("does not let a slow failure undo a newer successful connect", async () => {
        github.addAccount("github_pat_b", { login: "second" });
        const session = newSession();

        const release = github.deferNext();
        const slow = session.connect("github_pat_rejected");
        await session.connect("github_pat_b");
        release();
        await slow;

        expect(session.state.state.auth).toMatchObject({ status: "authenticated", error: null });
        expect(session.state.state.auth.viewer?.login).toBe("second");
    });

    it("discards a verification the user cancelled", async () => {
        github.addAccount(VALID_TOKEN);
        const session = newSession();

        const release = github.deferNext();
        const pending = session.connect(VALID_TOKEN);
        session.cancelConnect();
        release();
        await pending;

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", viewer: null });
        expect(store.entries()).toEqual({});
    });

    it("discards a verification that lands after the user disconnected", async () => {
        github.addAccount(VALID_TOKEN);
        const session = newSession();

        const release = github.deferNext();
        const pending = session.connect(VALID_TOKEN);
        await session.disconnect();
        release();
        await pending;

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", viewer: null });
        expect(store.entries()).toEqual({});
    });
});

describe("restore", () => {
    it("reuses a token kept from a previous visit", async () => {
        github.addAccount(VALID_TOKEN, { login: "quentin" });
        await newSession().connect(VALID_TOKEN);

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.state.state.auth.status).toBe("authenticated");
        expect(reloaded.state.state.auth.viewer?.login).toBe("quentin");
    });

    it("reports a stored token that GitHub no longer accepts", async () => {
        github.addAccount(VALID_TOKEN);
        await newSession().connect(VALID_TOKEN);
        github.revokeAccount(VALID_TOKEN);

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.state.state.auth).toMatchObject({ status: "unauthenticated", tokenStored: true });
        expect(reloaded.state.state.auth.error?.kind).toBe("unauthorized");
    });
});

describe("disconnect", () => {
    it("clears the token from the browser and from session state", async () => {
        github.addAccount(VALID_TOKEN);
        const session = newSession();
        await session.connect(VALID_TOKEN);

        await session.disconnect();

        expect(session.state.state.auth).toMatchObject({
            status: "unauthenticated",
            viewer: null,
            tokenStored: false,
        });
        expect(store.entries()).toEqual({});
    });

    it("leaves nothing behind for the next session to restore", async () => {
        github.addAccount(VALID_TOKEN);
        const session = newSession();
        await session.connect(VALID_TOKEN);
        await session.disconnect();

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.state.state.auth.status).toBe("unauthenticated");
    });
});
