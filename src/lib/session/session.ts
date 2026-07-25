import { Store } from "@tanstack/store";

import type { SessionError } from "#/lib/session/errors.ts";
import type { GithubClient, GithubViewer, KeyValueStore } from "#/lib/session/ports.ts";
import type { Repository } from "#/lib/session/types.ts";

import { missingToken, toSessionError } from "#/lib/session/errors.ts";

const TOKEN_KEY = "auth:token";
const SELECTED_REPOS_KEY = "repos:selected";
const REPOS_CACHE_KEY = "repos:cache";
/** Login the persisted repository preferences belong to. */
const REPOS_ACCOUNT_KEY = "repos:account";

export type AuthStatus = "restoring" | "unauthenticated" | "verifying" | "authenticated";

export type AuthState = {
    status: AuthStatus;
    viewer: GithubViewer | null;
    /** True when a token is held in browser storage, even if GitHub currently rejects it. */
    tokenStored: boolean;
    error: SessionError | null;
};

export type RepositoriesState = {
    status: "idle" | "loading" | "ready" | "error";
    /** True while GitHub is being re-queried, including when a cached list is already painted. */
    refreshing: boolean;
    available: Array<Repository>;
    /** `owner/repo` allowlist. The Inbox never looks outside it. */
    selected: Array<string>;
    error: SessionError | null;
    lastLoadedAt: string | null;
};

export type SessionState = {
    auth: AuthState;
    repos: RepositoriesState;
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

const initialRepositoriesState: RepositoriesState = {
    status: "idle",
    refreshing: false,
    available: [],
    selected: [],
    error: null,
    lastLoadedAt: null,
};

type RepositoriesCache = {
    available: Array<Repository>;
    lastLoadedAt: string | null;
};

/**
 * The single application port the UI talks to. It owns credentials, browser persistence and
 * every GitHub interaction, so behaviour can be tested without a DOM or a real GitHub.
 */
export function createEasyReviewSession({ github, store }: EasyReviewSessionDeps) {
    const state = new Store<SessionState>({ auth: initialAuthState, repos: initialRepositoriesState });

    /** The verified token, kept out of the reactive state so the UI can never render it. */
    let token: string | null = null;

    /**
     * Only the most recent credential check may write to state. Anything slower — a superseded
     * paste, a cancelled replacement, a request that lands after disconnect — is discarded.
     */
    let latestAuthAttempt = 0;
    let latestRepositoryLoad = 0;

    function setAuth(patch: Partial<AuthState>) {
        state.setState((prev) => ({ ...prev, auth: { ...prev.auth, ...patch } }));
    }

    function setRepos(patch: Partial<RepositoriesState>) {
        state.setState((prev) => ({ ...prev, repos: { ...prev.repos, ...patch } }));
    }

    function requireToken(): string {
        if (!token) {
            throw missingToken();
        }

        return token;
    }

    async function readJson<TValue>(key: string): Promise<TValue | null> {
        const raw = await store.get(key);

        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw) as TValue;
        } catch {
            return null;
        }
    }

    async function forgetRepositories(): Promise<void> {
        await Promise.all([
            store.remove(SELECTED_REPOS_KEY),
            store.remove(REPOS_CACHE_KEY),
            store.remove(REPOS_ACCOUNT_KEY),
        ]);
        setRepos({ ...initialRepositoriesState });
    }

    /**
     * Repository preferences belong to one GitHub account. Connecting a token for someone else
     * starts from a clean allowlist rather than showing them the previous account's repos.
     */
    async function loadRepositoryPreferences(login: string): Promise<void> {
        const account = await store.get(REPOS_ACCOUNT_KEY);

        if (account !== login) {
            await forgetRepositories();
            await store.set(REPOS_ACCOUNT_KEY, login);
            return;
        }

        const [selected, cache] = await Promise.all([
            readJson<Array<string>>(SELECTED_REPOS_KEY),
            readJson<RepositoriesCache>(REPOS_CACHE_KEY),
        ]);

        setRepos({
            selected: selected ?? [],
            available: cache?.available ?? [],
            lastLoadedAt: cache?.lastLoadedAt ?? null,
            status: cache?.available.length ? "ready" : "idle",
        });
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
            token = stored;
            await loadRepositoryPreferences(viewer.login);
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
            token = trimmed;
            await store.set(TOKEN_KEY, trimmed);
            await loadRepositoryPreferences(viewer.login);
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

    /**
     * Forget the token and everything derived from it. Repository names are cleared too: on a
     * shared machine they would otherwise say which private repos this person reviews.
     */
    async function disconnect(): Promise<void> {
        latestAuthAttempt++;
        latestRepositoryLoad++;
        token = null;
        await Promise.all([store.remove(TOKEN_KEY), forgetRepositories()]);
        setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
    }

    function dismissError(): void {
        setAuth({ error: null });
    }

    /** Ask GitHub which repositories this token can see. */
    async function refreshRepositories(): Promise<void> {
        const attempt = ++latestRepositoryLoad;
        const cached = state.state.repos.available;
        setRepos({ refreshing: true, status: cached.length ? "ready" : "loading", error: null });

        try {
            const available = await github.listRepositories(requireToken());
            if (attempt !== latestRepositoryLoad) return;

            const lastLoadedAt = new Date().toISOString();
            await store.set(REPOS_CACHE_KEY, JSON.stringify({ available, lastLoadedAt } satisfies RepositoriesCache));
            setRepos({ status: "ready", refreshing: false, available, lastLoadedAt, error: null });
        } catch (error) {
            if (attempt !== latestRepositoryLoad) return;
            setRepos({
                status: cached.length ? "ready" : "error",
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    /** Paint the cached list straight away, and only call GitHub when there is nothing to paint. */
    async function loadRepositories(): Promise<void> {
        if (state.state.repos.status === "ready" || state.state.repos.refreshing) {
            return;
        }

        await refreshRepositories();
    }

    async function setSelectedRepositories(selected: Array<string>): Promise<void> {
        const unique = [...new Set(selected)];
        setRepos({ selected: unique });
        await store.set(SELECTED_REPOS_KEY, JSON.stringify(unique));
    }

    async function toggleRepository(nameWithOwner: string, selected: boolean): Promise<void> {
        const current = state.state.repos.selected;
        const next = selected
            ? [...current, nameWithOwner]
            : current.filter((candidate) => candidate !== nameWithOwner);

        await setSelectedRepositories(next);
    }

    /** The allowlisted repositories, with the details GitHub gave us when we know them. */
    function getSelectedRepositories(): Array<Repository> {
        const { available, selected } = state.state.repos;
        const byName = new Map(available.map((repository) => [repository.nameWithOwner, repository]));

        return selected.map((nameWithOwner) => byName.get(nameWithOwner) ?? placeholderRepository(nameWithOwner));
    }

    return {
        state,
        restore,
        connect,
        cancelConnect,
        disconnect,
        dismissError,
        loadRepositories,
        refreshRepositories,
        setSelectedRepositories,
        toggleRepository,
        getSelectedRepositories,
    };
}

/** A repo the user picked before, whose details are not in the cache yet. */
function placeholderRepository(nameWithOwner: string): Repository {
    const [owner = nameWithOwner, name = ""] = nameWithOwner.split("/");

    return { nameWithOwner, owner, name, isPrivate: false, isArchived: false, pushedAt: null };
}

export type EasyReviewSession = ReturnType<typeof createEasyReviewSession>;
