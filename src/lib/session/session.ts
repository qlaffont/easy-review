import { Store } from "@tanstack/store";

import type { SessionError } from "#/lib/session/errors.ts";
import type { GithubClient, GithubViewer, KeyValueStore } from "#/lib/session/ports.ts";

import { toSessionError } from "#/lib/session/errors.ts";

const TOKEN_KEY = "auth:token";

export type AuthStatus = "restoring" | "unauthenticated" | "verifying" | "authenticated";

export type AuthState = {
    status: AuthStatus;
    viewer: GithubViewer | null;
    /** True when a token is held in browser storage, even if GitHub currently rejects it. */
    tokenStored: boolean;
    error: SessionError | null;
};

export type SessionState = {
    auth: AuthState;
};

export type EasyReviewSessionDeps = {
    github: GithubClient;
    store: KeyValueStore;
};

const initialAuthState: AuthState = {
    status: "restoring",
    viewer: null,
    tokenStored: false,
    error: null,
};

/**
 * The single application port the UI talks to. It owns credentials, browser persistence and
 * every GitHub interaction, so behaviour can be tested without a DOM or a real GitHub.
 */
export function createEasyReviewSession({ github, store }: EasyReviewSessionDeps) {
    const state = new Store<SessionState>({ auth: initialAuthState });

    /**
     * Only the most recent credential check may write to state. Anything slower — a superseded
     * paste, a cancelled replacement, a request that lands after disconnect — is discarded.
     */
    let latestAuthAttempt = 0;

    function setAuth(patch: Partial<AuthState>) {
        state.setState((prev) => ({ ...prev, auth: { ...prev.auth, ...patch } }));
    }

    /**
     * Load any previously stored token and check it is still accepted by GitHub. Stays in the
     * `restoring` status throughout so the UI shows one boot state instead of flashing the
     * connect screen at someone who is already signed in.
     */
    async function restore(): Promise<void> {
        const attempt = ++latestAuthAttempt;
        const stored = await store.get(TOKEN_KEY);

        if (attempt !== latestAuthAttempt) {
            return;
        }

        if (!stored) {
            setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
            return;
        }

        setAuth({ tokenStored: true });

        try {
            const viewer = await github.getViewer(stored);
            if (attempt !== latestAuthAttempt) return;
            setAuth({ status: "authenticated", viewer, error: null });
        } catch (error) {
            if (attempt !== latestAuthAttempt) return;
            setAuth({ status: "unauthenticated", viewer: null, error: toSessionError(error) });
        }
    }

    /** Validate a pasted token and, only if GitHub accepts it, persist it in the browser. */
    async function connect(candidate: string): Promise<void> {
        const trimmed = candidate.trim();

        if (!trimmed) {
            setAuth({
                error: {
                    kind: "unauthorized",
                    message: "Paste a fine-grained personal access token to continue.",
                },
            });
            return;
        }

        const attempt = ++latestAuthAttempt;
        const previous = state.state.auth;
        setAuth({ status: "verifying", error: null });

        try {
            const viewer = await github.getViewer(trimmed);
            if (attempt !== latestAuthAttempt) return;
            await store.set(TOKEN_KEY, trimmed);
            setAuth({ status: "authenticated", viewer, tokenStored: true, error: null });
        } catch (error) {
            if (attempt !== latestAuthAttempt) return;
            setAuth({
                status: previous.viewer ? "authenticated" : "unauthenticated",
                viewer: previous.viewer,
                error: toSessionError(error),
            });
        }
    }

    /** Abandon a verification in progress and go back to the state it started from. */
    function cancelConnect(): void {
        latestAuthAttempt++;
        const { auth } = state.state;

        if (auth.status === "verifying") {
            setAuth({ status: auth.viewer ? "authenticated" : "unauthenticated", error: null });
        }
    }

    /** Forget the token and everything derived from it. */
    async function disconnect(): Promise<void> {
        latestAuthAttempt++;
        await store.remove(TOKEN_KEY);
        setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
    }

    function dismissError(): void {
        setAuth({ error: null });
    }

    return { state, restore, connect, cancelConnect, disconnect, dismissError };
}

export type EasyReviewSession = ReturnType<typeof createEasyReviewSession>;
