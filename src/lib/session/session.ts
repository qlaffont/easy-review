import { Store } from "@tanstack/store";

import type { SessionError } from "#/lib/session/errors.ts";
import type { InboxSection, InboxSectionId } from "#/lib/session/inbox-sections.ts";
import type { GithubClient, GithubViewer, KeyValueStore } from "#/lib/session/ports.ts";
import type {
    DiffSide,
    FileDiff,
    PendingLineComment,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    Repository,
    ReviewDraft,
    ReviewEvent,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import { EasyReviewError, missingToken, toSessionError } from "#/lib/session/errors.ts";
import { DEFAULT_INBOX_SECTIONS, groupIntoSections } from "#/lib/session/inbox-sections.ts";

const TOKEN_KEY = "auth:token";
const SELECTED_REPOS_KEY = "repos:selected";
const REPOS_CACHE_KEY = "repos:cache";
/** Login the persisted repository preferences belong to. */
const REPOS_ACCOUNT_KEY = "repos:account";
const INBOX_CACHE_KEY = "inbox:cache";
const INBOX_EXPANDED_KEY = "inbox:expanded";
/** Index of every persisted draft key so disconnect can wipe them without a store scan. */
const DRAFT_INDEX_KEY = "review-drafts:index";

function draftStorageKey(login: string, repository: string, number: number): string {
    return `review-draft:${login}:${repository}#${number}`;
}

const DEFAULT_EXPANDED_SECTIONS: Array<InboxSectionId> = ["needs-your-review", "returned-to-you"];

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

export type InboxState = {
    status: "idle" | "loading" | "ready" | "error";
    /** True while GitHub is being re-queried, including when cached rows are already painted. */
    refreshing: boolean;
    /** Set when the allowlist changed, so the next load goes to the network. */
    stale: boolean;
    pullRequests: Array<PullRequestSummary>;
    expandedSections: Array<InboxSectionId>;
    error: SessionError | null;
    lastLoadedAt: string | null;
};

export type FilesListState = {
    status: "idle" | "loading" | "ready" | "error";
    refreshing: boolean;
    items: Array<PullRequestFile>;
    error: SessionError | null;
    lastLoadedAt: string | null;
};

export type FileDiffState = {
    status: "idle" | "loading" | "ready" | "error";
    refreshing: boolean;
    diff: FileDiff | null;
    error: SessionError | null;
};

/**
 * One pull request's overview. Details are held for the life of the tab only: they are large,
 * they go stale quickly, and the persisted Inbox row is enough to paint a page header instantly.
 */
export type PullRequestView = {
    status: "idle" | "loading" | "ready" | "error";
    refreshing: boolean;
    detail: PullRequestDetail | null;
    error: SessionError | null;
    lastLoadedAt: string | null;
    files: FilesListState;
    /** Keyed by path. Diff bodies are fetched one file at a time. */
    diffs: Record<string, FileDiffState>;
};

/** What a PR page renders: the full detail when it has arrived, the Inbox row until then. */
export type PullRequestPage = PullRequestView & {
    repository: string;
    number: number;
    summary: PullRequestSummary | null;
};

export type ReviewThreadsState = {
    status: "idle" | "loading" | "ready" | "error";
    items: Array<ReviewThread>;
    error: SessionError | null;
};

export type SessionState = {
    auth: AuthState;
    repos: RepositoriesState;
    inbox: InboxState;
    /** Keyed by `owner/repo#number`. */
    pullRequests: Record<string, PullRequestView>;
    /** Staged reviews keyed by `owner/repo#number`. */
    reviewDrafts: Record<string, ReviewDraft>;
    /** Existing threads keyed by `owner/repo#number`. */
    reviewThreads: Record<string, ReviewThreadsState>;
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

const initialInboxState: InboxState = {
    status: "idle",
    refreshing: false,
    stale: false,
    pullRequests: [],
    expandedSections: DEFAULT_EXPANDED_SECTIONS,
    error: null,
    lastLoadedAt: null,
};

const initialFilesListState: FilesListState = {
    status: "idle",
    refreshing: false,
    items: [],
    error: null,
    lastLoadedAt: null,
};

const initialFileDiffState: FileDiffState = {
    status: "idle",
    refreshing: false,
    diff: null,
    error: null,
};

const initialPullRequestView: PullRequestView = {
    status: "idle",
    refreshing: false,
    detail: null,
    error: null,
    lastLoadedAt: null,
    files: initialFilesListState,
    diffs: {},
};

type RepositoriesCache = {
    available: Array<Repository>;
    lastLoadedAt: string | null;
};

type InboxCache = {
    pullRequests: Array<PullRequestSummary>;
    lastLoadedAt: string | null;
};

/**
 * The single application port the UI talks to. It owns credentials, browser persistence and
 * every GitHub interaction, so behaviour can be tested without a DOM or a real GitHub.
 */
export function createEasyReviewSession({ github, store }: EasyReviewSessionDeps) {
    const initialThreadsState: ReviewThreadsState = { status: "idle", items: [], error: null };

    const state = new Store<SessionState>({
        auth: initialAuthState,
        repos: initialRepositoriesState,
        inbox: initialInboxState,
        pullRequests: {},
        reviewDrafts: {},
        reviewThreads: {},
    });

    /** The verified token, kept out of the reactive state so the UI can never render it. */
    let token: string | null = null;

    /**
     * Only the most recent credential check may write to state. Anything slower — a superseded
     * paste, a cancelled replacement, a request that lands after disconnect — is discarded.
     */
    let latestAuthAttempt = 0;
    let latestRepositoryLoad = 0;
    let latestInboxLoad = 0;
    /** The same rule per pull request, since several pages can be opened in one tab's history. */
    const latestPullRequestLoads = new Map<string, number>();
    const latestFileListLoads = new Map<string, number>();
    const latestFileDiffLoads = new Map<string, number>();
    const latestReviewThreadLoads = new Map<string, number>();
    /** Last-write-wins for summary typing so overlapping persists cannot drop characters. */
    const latestDraftBodyWrites = new Map<string, number>();

    function setAuth(patch: Partial<AuthState>) {
        state.setState((prev) => ({ ...prev, auth: { ...prev.auth, ...patch } }));
    }

    function setRepos(patch: Partial<RepositoriesState>) {
        state.setState((prev) => ({ ...prev, repos: { ...prev.repos, ...patch } }));
    }

    function setInbox(patch: Partial<InboxState>) {
        state.setState((prev) => ({ ...prev, inbox: { ...prev.inbox, ...patch } }));
    }

    function setPullRequest(key: string, patch: Partial<PullRequestView>) {
        state.setState((prev) => ({
            ...prev,
            pullRequests: {
                ...prev.pullRequests,
                [key]: { ...(prev.pullRequests[key] ?? initialPullRequestView), ...patch },
            },
        }));
    }

    function setFiles(key: string, patch: Partial<FilesListState>) {
        state.setState((prev) => {
            const current = prev.pullRequests[key] ?? initialPullRequestView;

            return {
                ...prev,
                pullRequests: {
                    ...prev.pullRequests,
                    [key]: { ...current, files: { ...current.files, ...patch } },
                },
            };
        });
    }

    function setFileDiff(key: string, path: string, patch: Partial<FileDiffState>) {
        state.setState((prev) => {
            const current = prev.pullRequests[key] ?? initialPullRequestView;

            return {
                ...prev,
                pullRequests: {
                    ...prev.pullRequests,
                    [key]: {
                        ...current,
                        diffs: {
                            ...current.diffs,
                            [path]: { ...(current.diffs[path] ?? initialFileDiffState), ...patch },
                        },
                    },
                },
            };
        });
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

    /** Drops everything that describes one account's work: repos, allowlist, cached Inbox. */
    async function forgetAccountData(): Promise<void> {
        for (const [key, attempt] of latestPullRequestLoads) {
            latestPullRequestLoads.set(key, attempt + 1);
        }

        for (const [key, attempt] of latestFileListLoads) {
            latestFileListLoads.set(key, attempt + 1);
        }

        for (const [key, attempt] of latestFileDiffLoads) {
            latestFileDiffLoads.set(key, attempt + 1);
        }

        for (const [key, attempt] of latestReviewThreadLoads) {
            latestReviewThreadLoads.set(key, attempt + 1);
        }

        await Promise.all([
            store.remove(SELECTED_REPOS_KEY),
            store.remove(REPOS_CACHE_KEY),
            store.remove(REPOS_ACCOUNT_KEY),
            store.remove(INBOX_CACHE_KEY),
            store.remove(INBOX_EXPANDED_KEY),
            clearDraftStorage(),
        ]);
        setRepos({ ...initialRepositoriesState });
        setInbox({ ...initialInboxState });
        state.setState((prev) => ({ ...prev, pullRequests: {}, reviewDrafts: {}, reviewThreads: {} }));
    }

    /**
     * Preferences belong to one GitHub account. Connecting a token for someone else starts from a
     * clean allowlist rather than showing them the previous account's repos and pull requests.
     */
    async function loadAccountPreferences(login: string): Promise<void> {
        const account = await store.get(REPOS_ACCOUNT_KEY);

        if (account !== login) {
            await forgetAccountData();
            await store.set(REPOS_ACCOUNT_KEY, login);
            return;
        }

        const [selected, repositories, inbox, expanded] = await Promise.all([
            readJson<Array<string>>(SELECTED_REPOS_KEY),
            readJson<RepositoriesCache>(REPOS_CACHE_KEY),
            readJson<InboxCache>(INBOX_CACHE_KEY),
            readJson<Array<InboxSectionId>>(INBOX_EXPANDED_KEY),
        ]);

        setRepos({
            selected: selected ?? [],
            available: repositories?.available ?? [],
            lastLoadedAt: repositories?.lastLoadedAt ?? null,
            status: repositories?.available.length ? "ready" : "idle",
        });

        setInbox({
            pullRequests: inbox?.pullRequests ?? [],
            lastLoadedAt: inbox?.lastLoadedAt ?? null,
            status: inbox?.pullRequests.length ? "ready" : "idle",
            expandedSections: expanded ?? DEFAULT_EXPANDED_SECTIONS,
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
            await loadAccountPreferences(viewer.login);
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
            await loadAccountPreferences(viewer.login);
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
        latestInboxLoad++;
        token = null;
        await Promise.all([store.remove(TOKEN_KEY), forgetAccountData()]);
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
        setInbox({ stale: true });
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

    /** Ask GitHub for the open and recently merged pull requests of the allowlisted repos. */
    async function refreshInbox(): Promise<void> {
        const attempt = ++latestInboxLoad;
        const { selected } = state.state.repos;
        const cached = state.state.inbox.pullRequests;

        if (selected.length === 0) {
            setInbox({ status: "ready", refreshing: false, stale: false, pullRequests: [], error: null });
            return;
        }

        setInbox({ refreshing: true, status: cached.length ? "ready" : "loading", error: null });

        try {
            const pullRequests = await github.listPullRequests(requireToken(), selected);
            if (attempt !== latestInboxLoad) return;

            const lastLoadedAt = new Date().toISOString();
            await store.set(INBOX_CACHE_KEY, JSON.stringify({ pullRequests, lastLoadedAt } satisfies InboxCache));
            setInbox({
                status: "ready",
                refreshing: false,
                stale: false,
                pullRequests,
                lastLoadedAt,
                error: null,
            });
        } catch (error) {
            if (attempt !== latestInboxLoad) return;
            setInbox({
                status: cached.length ? "ready" : "error",
                refreshing: false,
                stale: false,
                error: toSessionError(error),
            });
        }
    }

    /** Paint whatever is cached, and only call GitHub when there is nothing usable to paint. */
    async function loadInbox(): Promise<void> {
        const { inbox } = state.state;

        if (inbox.refreshing) {
            return;
        }

        if (inbox.status === "ready" && !inbox.stale) {
            return;
        }

        await refreshInbox();
    }

    /**
     * Called on tab focus and when a section is opened. Never runs on a timer: a tab left open
     * should not spend the user's rate limit.
     */
    async function revalidateInbox(): Promise<void> {
        if (state.state.inbox.refreshing) {
            return;
        }

        await refreshInbox();
    }

    async function toggleSection(id: InboxSectionId): Promise<void> {
        const { expandedSections } = state.state.inbox;
        const isExpanded = expandedSections.includes(id);
        const next = isExpanded ? expandedSections.filter((section) => section !== id) : [...expandedSections, id];

        setInbox({ expandedSections: next });
        await store.set(INBOX_EXPANDED_KEY, JSON.stringify(next));

        if (!isExpanded) {
            await revalidateInbox();
        }
    }

    /** Ask GitHub for one pull request in full. */
    async function refreshPullRequest(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestPullRequestLoads.get(key) ?? 0) + 1;
        latestPullRequestLoads.set(key, attempt);

        const cached = state.state.pullRequests[key]?.detail ?? null;
        setPullRequest(key, { refreshing: true, status: cached ? "ready" : "loading", error: null });

        try {
            const detail = await github.getPullRequest(requireToken(), repository, number);
            if (attempt !== latestPullRequestLoads.get(key)) return;

            setPullRequest(key, {
                status: "ready",
                refreshing: false,
                detail,
                lastLoadedAt: new Date().toISOString(),
                error: null,
            });
            await syncDraftWithHead(detail);
        } catch (error) {
            if (attempt !== latestPullRequestLoads.get(key)) return;
            setPullRequest(key, {
                status: cached ? "ready" : "error",
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    /** Reuse what this tab already fetched, and only call GitHub when there is nothing to show. */
    async function loadPullRequest(repository: string, number: number): Promise<void> {
        const view = state.state.pullRequests[pullRequestKey(repository, number)];

        if (view?.refreshing || view?.status === "ready") {
            return;
        }

        await refreshPullRequest(repository, number);
    }

    /** Called when the tab regains focus while a pull request is open, and by manual refresh. */
    async function revalidatePullRequest(repository: string, number: number): Promise<void> {
        if (state.state.pullRequests[pullRequestKey(repository, number)]?.refreshing) {
            return;
        }

        await refreshPullRequest(repository, number);
    }

    /**
     * The overview, with the Inbox row alongside it. The row is persisted and the detail is not,
     * so after a reload the page has a title and an author to paint before GitHub answers.
     */
    function getPullRequestPage(repository: string, number: number): PullRequestPage {
        const key = pullRequestKey(repository, number);
        const view = state.state.pullRequests[key] ?? initialPullRequestView;
        const summary = state.state.inbox.pullRequests.find((pullRequest) => pullRequest.key === key) ?? null;

        return { ...view, repository, number, summary };
    }

    /** Paths only — opening Review Changes must not download every patch. */
    async function refreshPullRequestFiles(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestFileListLoads.get(key) ?? 0) + 1;
        latestFileListLoads.set(key, attempt);

        const cached = state.state.pullRequests[key]?.files.items ?? [];
        setFiles(key, { refreshing: true, status: cached.length ? "ready" : "loading", error: null });

        try {
            const items = await github.listPullRequestFiles(requireToken(), repository, number);
            if (attempt !== latestFileListLoads.get(key)) return;

            // Drop cached diffs: the head may have moved, and loadFileDiff would otherwise keep
            // serving the pre-refresh patch for the still-selected path.
            setPullRequest(key, {
                files: {
                    status: "ready",
                    refreshing: false,
                    items,
                    lastLoadedAt: new Date().toISOString(),
                    error: null,
                },
                diffs: {},
            });
        } catch (error) {
            if (attempt !== latestFileListLoads.get(key)) return;
            setFiles(key, {
                status: cached.length ? "ready" : "error",
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    async function loadPullRequestFiles(repository: string, number: number): Promise<void> {
        const files = state.state.pullRequests[pullRequestKey(repository, number)]?.files;

        if (files?.refreshing || files?.status === "ready") {
            return;
        }

        await refreshPullRequestFiles(repository, number);
    }

    /**
     * Fetch one file's diff. `force` skips the generated / huge stubs; binary files still refuse.
     * Opening file A must never request file B.
     */
    async function loadFileDiff(
        repository: string,
        number: number,
        path: string,
        { force = false }: { force?: boolean } = {},
    ): Promise<void> {
        const key = pullRequestKey(repository, number);
        const diffKey = `${key}:${path}`;
        const attempt = (latestFileDiffLoads.get(diffKey) ?? 0) + 1;
        latestFileDiffLoads.set(diffKey, attempt);

        const cached = state.state.pullRequests[key]?.diffs[path]?.diff ?? null;

        // A warm non-stubbed diff is reused unless the reviewer is forcing past a stub.
        if (
            !force &&
            cached &&
            cached.stub === null &&
            state.state.pullRequests[key]?.diffs[path]?.status === "ready"
        ) {
            return;
        }

        setFileDiff(key, path, { refreshing: true, status: cached ? "ready" : "loading", error: null });

        try {
            const previousPath =
                state.state.pullRequests[key]?.files.items.find((file) => file.path === path)?.previousPath ?? null;
            const diff = await github.getPullRequestFileDiff(requireToken(), repository, number, path, {
                force,
                previousPath,
            });
            if (attempt !== latestFileDiffLoads.get(diffKey)) return;

            setFileDiff(key, path, { status: "ready", refreshing: false, diff, error: null });
        } catch (error) {
            if (attempt !== latestFileDiffLoads.get(diffKey)) return;
            setFileDiff(key, path, {
                status: cached ? "ready" : "error",
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    function getFileDiff(repository: string, number: number, path: string): FileDiffState {
        return state.state.pullRequests[pullRequestKey(repository, number)]?.diffs[path] ?? initialFileDiffState;
    }

    function emptyDraft(repository: string, number: number, headSha: string): ReviewDraft {
        return {
            repository,
            number,
            headSha,
            event: "comment",
            body: "",
            comments: [],
            stale: false,
        };
    }

    function viewerLogin(): string | null {
        return state.state.auth.viewer?.login ?? null;
    }

    async function clearDraftStorage(): Promise<void> {
        const keys = (await readJson<Array<string>>(DRAFT_INDEX_KEY)) ?? [];
        await Promise.all([...keys.map((key) => store.remove(key)), store.remove(DRAFT_INDEX_KEY)]);
    }

    async function rememberDraftKey(storageKey: string): Promise<void> {
        const keys = (await readJson<Array<string>>(DRAFT_INDEX_KEY)) ?? [];
        if (!keys.includes(storageKey)) {
            await store.set(DRAFT_INDEX_KEY, JSON.stringify([...keys, storageKey]));
        }
    }

    async function persistDraft(draft: ReviewDraft): Promise<void> {
        const key = pullRequestKey(draft.repository, draft.number);
        state.setState((prev) => ({ ...prev, reviewDrafts: { ...prev.reviewDrafts, [key]: draft } }));

        const login = viewerLogin();
        if (!login) {
            return;
        }

        const storageKey = draftStorageKey(login, draft.repository, draft.number);
        await store.set(storageKey, JSON.stringify(draft));
        await rememberDraftKey(storageKey);
    }

    /**
     * Load a draft from browser storage (or create an empty one) and mark it stale when the live
     * head has moved past the SHA the comments were written against. An empty stored head means
     * the draft was staged before the PR detail arrived — bind it to the live tip, do not stale it.
     */
    async function syncDraftWithHead(detail: PullRequestDetail): Promise<void> {
        const key = pullRequestKey(detail.repository, detail.number);
        const login = viewerLogin();
        const stored = login
            ? await readJson<ReviewDraft>(draftStorageKey(login, detail.repository, detail.number))
            : null;
        const base = stored ?? emptyDraft(detail.repository, detail.number, detail.headSha);
        const boundHead = Boolean(stored?.headSha);
        const draft: ReviewDraft = {
            ...base,
            repository: detail.repository,
            number: detail.number,
            stale: boundHead && stored!.headSha !== detail.headSha,
            headSha: boundHead ? stored!.headSha : detail.headSha,
        };

        state.setState((prev) => ({ ...prev, reviewDrafts: { ...prev.reviewDrafts, [key]: draft } }));

        if (stored && !boundHead && draft.comments.length > 0) {
            await persistDraft(draft);
        }
    }

    function getReviewDraft(repository: string, number: number): ReviewDraft {
        const key = pullRequestKey(repository, number);
        const live = state.state.reviewDrafts[key];
        if (live) {
            return live;
        }

        const headSha = state.state.pullRequests[key]?.detail?.headSha ?? "";
        return emptyDraft(repository, number, headSha);
    }

    async function ensureDraft(repository: string, number: number): Promise<ReviewDraft> {
        const key = pullRequestKey(repository, number);
        const existing = state.state.reviewDrafts[key];
        if (existing) {
            return existing;
        }

        const detail = state.state.pullRequests[key]?.detail;
        if (detail) {
            await syncDraftWithHead(detail);
            return state.state.reviewDrafts[key] ?? emptyDraft(repository, number, detail.headSha);
        }

        const draft = emptyDraft(repository, number, "");
        state.setState((prev) => ({ ...prev, reviewDrafts: { ...prev.reviewDrafts, [key]: draft } }));
        return draft;
    }

    async function setReviewEvent(repository: string, number: number, event: ReviewEvent): Promise<void> {
        const draft = await ensureDraft(repository, number);
        await persistDraft({ ...draft, event });
    }

    async function setReviewBody(repository: string, number: number, body: string): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestDraftBodyWrites.get(key) ?? 0) + 1;
        latestDraftBodyWrites.set(key, attempt);
        await ensureDraft(repository, number);
        if (attempt !== latestDraftBodyWrites.get(key)) {
            return;
        }

        const draft = state.state.reviewDrafts[key] ?? (await ensureDraft(repository, number));
        await persistDraft({ ...draft, body });
    }

    async function addPendingComment(
        repository: string,
        number: number,
        input: { path: string; line: number; side: DiffSide; body: string },
    ): Promise<PendingLineComment> {
        const draft = await ensureDraft(repository, number);
        const headSha = state.state.pullRequests[pullRequestKey(repository, number)]?.detail?.headSha ?? draft.headSha;
        const comment: PendingLineComment = {
            id: crypto.randomUUID(),
            path: input.path,
            line: input.line,
            side: input.side,
            body: input.body,
        };

        await persistDraft({
            ...draft,
            headSha: draft.comments.length === 0 && !draft.stale ? headSha : draft.headSha,
            comments: [...draft.comments, comment],
        });

        return comment;
    }

    async function updatePendingComment(
        repository: string,
        number: number,
        commentId: string,
        body: string,
    ): Promise<void> {
        const draft = await ensureDraft(repository, number);
        await persistDraft({
            ...draft,
            comments: draft.comments.map((comment) => (comment.id === commentId ? { ...comment, body } : comment)),
        });
    }

    async function removePendingComment(repository: string, number: number, commentId: string): Promise<void> {
        const draft = await ensureDraft(repository, number);
        const comments = draft.comments.filter((comment) => comment.id !== commentId);
        await persistDraft({ ...draft, comments });
    }

    /** Drop a stale or unwanted draft so the reviewer can start clean against the current head. */
    async function discardReviewDraft(repository: string, number: number): Promise<void> {
        const headSha = state.state.pullRequests[pullRequestKey(repository, number)]?.detail?.headSha ?? "";
        await persistDraft(emptyDraft(repository, number, headSha));
    }

    async function submitReview(repository: string, number: number): Promise<void> {
        const draft = await ensureDraft(repository, number);
        const detail = state.state.pullRequests[pullRequestKey(repository, number)]?.detail;

        if (!detail) {
            throw new EasyReviewError("unknown", "Load the pull request before submitting a review.");
        }

        if (draft.stale || draft.headSha !== detail.headSha) {
            throw new EasyReviewError(
                "unknown",
                "This draft was written against an older head commit. Discard it and review the new tip.",
            );
        }

        if (!draft.body.trim() && draft.comments.length === 0 && draft.event === "comment") {
            throw new EasyReviewError("unknown", "Add a comment or a summary before submitting a review.");
        }

        await github.submitReview(requireToken(), {
            repository,
            number,
            headSha: detail.headSha,
            event: draft.event,
            body: draft.body,
            comments: draft.comments.map(({ path, line, side, body }) => ({ path, line, side, body })),
        });

        await persistDraft(emptyDraft(repository, number, detail.headSha));
        await loadReviewThreads(repository, number);
    }

    async function loadReviewThreads(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestReviewThreadLoads.get(key) ?? 0) + 1;
        latestReviewThreadLoads.set(key, attempt);

        state.setState((prev) => ({
            ...prev,
            reviewThreads: {
                ...prev.reviewThreads,
                [key]: { status: "loading", items: prev.reviewThreads[key]?.items ?? [], error: null },
            },
        }));

        try {
            const items = await github.listReviewThreads(requireToken(), repository, number);
            if (attempt !== latestReviewThreadLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                reviewThreads: { ...prev.reviewThreads, [key]: { status: "ready", items, error: null } },
            }));
        } catch (error) {
            if (attempt !== latestReviewThreadLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                reviewThreads: {
                    ...prev.reviewThreads,
                    [key]: {
                        status: "error",
                        items: prev.reviewThreads[key]?.items ?? [],
                        error: toSessionError(error),
                    },
                },
            }));
        }
    }

    function getReviewThreads(repository: string, number: number): ReviewThreadsState {
        return state.state.reviewThreads[pullRequestKey(repository, number)] ?? initialThreadsState;
    }

    async function replyToReviewThread(
        repository: string,
        number: number,
        threadId: string,
        body: string,
    ): Promise<ReviewThreadComment> {
        const trimmed = body.trim();
        if (!trimmed) {
            throw new EasyReviewError("unknown", "Write a reply before sending it.");
        }

        const reply = await github.replyToReviewThread(requireToken(), threadId, trimmed);
        const key = pullRequestKey(repository, number);
        state.setState((prev) => {
            const current = prev.reviewThreads[key] ?? initialThreadsState;
            return {
                ...prev,
                reviewThreads: {
                    ...prev.reviewThreads,
                    [key]: {
                        ...current,
                        items: current.items.map((thread) =>
                            thread.id === threadId ? { ...thread, comments: [...thread.comments, reply] } : thread,
                        ),
                    },
                },
            };
        });
        return reply;
    }

    /** Every default section, empty ones included, holding only allowlisted repositories. */
    function getInboxSections(): Array<InboxSection> {
        const { inbox, repos, auth } = state.state;
        const selected = new Set(repos.selected);
        const visible = inbox.pullRequests.filter((pullRequest) => selected.has(pullRequest.repository));

        return groupIntoSections(visible, auth.viewer?.login ?? "", DEFAULT_INBOX_SECTIONS);
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
        loadInbox,
        refreshInbox,
        revalidateInbox,
        toggleSection,
        getInboxSections,
        loadPullRequest,
        refreshPullRequest,
        revalidatePullRequest,
        getPullRequestPage,
        loadPullRequestFiles,
        refreshPullRequestFiles,
        loadFileDiff,
        getFileDiff,
        getReviewDraft,
        setReviewEvent,
        setReviewBody,
        addPendingComment,
        updatePendingComment,
        removePendingComment,
        discardReviewDraft,
        submitReview,
        loadReviewThreads,
        getReviewThreads,
        replyToReviewThread,
    };
}

/** The identity a pull request keeps everywhere: Inbox row, cache key, route. */
export function pullRequestKey(repository: string, number: number): string {
    return `${repository}#${number}`;
}

/** A repo the user picked before, whose details are not in the cache yet. */
function placeholderRepository(nameWithOwner: string): Repository {
    const [owner = nameWithOwner, name = ""] = nameWithOwner.split("/");

    return { nameWithOwner, owner, name, isPrivate: false, isArchived: false, pushedAt: null };
}

export type EasyReviewSession = ReturnType<typeof createEasyReviewSession>;
