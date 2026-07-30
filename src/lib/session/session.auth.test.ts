import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const VALID_CREDENTIAL = "test_cred_valid";

let github: FakeGithub;
let store: MemoryStore;

function newSession() {
    return createEasyReviewSession({ github, queryClient: createTestQueryClient(), store });
}

function oauthSession(sessionCredential = "session") {
    return createEasyReviewSession({
        github,
        queryClient: createTestQueryClient(),
        store,
        oauth: {
            sessionCredential,
            logout: async () => undefined,
            beginLogin: () => undefined,
        },
    });
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
});

describe("auth state", () => {
    it("starts as restoring so the UI can wait for the OAuth cookie probe", () => {
        const session = newSession();

        expect(session.state.state.auth.status).toBe("restoring");
    });

    it("settles as unauthenticated without calling GitHub when OAuth is not configured", async () => {
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
    it("authenticates an in-memory credential GitHub accepts (tests / fixtures)", async () => {
        github.addAccount(VALID_CREDENTIAL, { login: "quentin" });
        const session = newSession();

        await session.connect(VALID_CREDENTIAL);

        expect(session.state.state.auth).toMatchObject({
            status: "authenticated",
            tokenStored: true,
            error: null,
        });
        expect(session.state.state.auth.viewer?.login).toBe("quentin");
        expect(store.entries()["auth:token"]).toBeUndefined();
    });

    it("trims whitespace around the credential", async () => {
        github.addAccount(VALID_CREDENTIAL);
        const session = newSession();

        await session.connect(`  ${VALID_CREDENTIAL}\n`);

        expect(session.state.state.auth.status).toBe("authenticated");
    });

    it("rejects an empty credential without calling GitHub", async () => {
        const session = newSession();

        await session.connect("   ");

        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
        expect(github.calls).toEqual([]);
    });

    it("explains an unauthorized credential", async () => {
        const session = newSession();

        await session.connect("test_cred_revoked");

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", tokenStored: false });
        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
    });

    it("explains a rate-limited response and keeps the retry time", async () => {
        const retryAt = new Date("2026-01-01T10:00:00.000Z").toISOString();
        github.failNextWith(new EasyReviewError("rate-limited", "GitHub rate limit reached.", { retryAt }));
        const session = newSession();

        await session.connect(VALID_CREDENTIAL);

        expect(session.state.state.auth.error).toMatchObject({ kind: "rate-limited", retryAt });
        expect(session.state.state.auth.status).toBe("unauthenticated");
    });

    it("replaces a working credential with another one", async () => {
        github.addAccount(VALID_CREDENTIAL, { login: "quentin" });
        github.addAccount("test_cred_other", { login: "octocat" });
        const session = newSession();
        await session.connect(VALID_CREDENTIAL);

        await session.connect("test_cred_other");

        expect(session.state.state.auth.viewer?.login).toBe("octocat");
    });

    it("keeps the working session when a replacement credential is rejected", async () => {
        github.addAccount(VALID_CREDENTIAL, { login: "quentin" });
        const session = newSession();
        await session.connect(VALID_CREDENTIAL);

        await session.connect("test_cred_typo");

        expect(session.state.state.auth.status).toBe("authenticated");
        expect(session.state.state.auth.viewer?.login).toBe("quentin");
        expect(session.state.state.auth.error?.kind).toBe("unauthorized");
    });
});

describe("overlapping credential checks", () => {
    it("keeps the result of the most recent connect, whatever order GitHub replies in", async () => {
        github.addAccount("test_cred_a", { login: "first" });
        github.addAccount("test_cred_b", { login: "second" });
        const session = newSession();

        const release = github.deferNext();
        const slow = session.connect("test_cred_a");
        await session.connect("test_cred_b");
        release();
        await slow;

        expect(session.state.state.auth.viewer?.login).toBe("second");
    });

    it("does not let a slow failure undo a newer successful connect", async () => {
        github.addAccount("test_cred_b", { login: "second" });
        const session = newSession();

        const release = github.deferNext();
        const slow = session.connect("test_cred_rejected");
        await session.connect("test_cred_b");
        release();
        await slow;

        expect(session.state.state.auth).toMatchObject({ status: "authenticated", error: null });
        expect(session.state.state.auth.viewer?.login).toBe("second");
    });

    it("discards a verification the user cancelled", async () => {
        github.addAccount(VALID_CREDENTIAL);
        const session = newSession();

        const release = github.deferNext();
        const pending = session.connect(VALID_CREDENTIAL);
        session.cancelConnect();
        release();
        await pending;

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", viewer: null });
    });

    it("discards a verification that lands after the user disconnected", async () => {
        github.addAccount(VALID_CREDENTIAL);
        const session = newSession();

        const release = github.deferNext();
        const pending = session.connect(VALID_CREDENTIAL);
        await session.disconnect();
        release();
        await pending;

        expect(session.state.state.auth).toMatchObject({ status: "unauthenticated", viewer: null });
    });
});

describe("oauth restore", () => {
    it("probes the session credential and never keeps a browser-stored secret", async () => {
        github.addAccount("session", { login: "quentin" });
        await store.set("auth:token", "leftover-secret");

        const session = oauthSession();
        await session.restore();

        expect(session.state.state.auth).toMatchObject({
            status: "authenticated",
            tokenStored: true,
            error: null,
        });
        expect(session.state.state.auth.viewer?.login).toBe("quentin");
        expect(store.entries()["auth:token"]).toBeUndefined();
    });

    it("settles quietly when the OAuth cookie is missing", async () => {
        const session = oauthSession();

        await session.restore();

        expect(session.state.state.auth).toMatchObject({
            status: "unauthenticated",
            viewer: null,
            tokenStored: false,
            error: null,
        });
    });
});

describe("disconnect", () => {
    it("clears session state", async () => {
        github.addAccount(VALID_CREDENTIAL);
        const session = newSession();
        await session.connect(VALID_CREDENTIAL);

        await session.disconnect();

        expect(session.state.state.auth).toMatchObject({
            status: "unauthenticated",
            viewer: null,
            tokenStored: false,
        });
    });

    it("leaves the next restore unauthenticated without OAuth", async () => {
        github.addAccount(VALID_CREDENTIAL);
        const session = newSession();
        await session.connect(VALID_CREDENTIAL);
        await session.disconnect();

        const reloaded = newSession();
        await reloaded.restore();

        expect(reloaded.state.state.auth.status).toBe("unauthenticated");
    });
});
