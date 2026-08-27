import type { QueryClient } from "@tanstack/react-query";

import { Store } from "@tanstack/store";

import type {
    ConversationQueryData,
    FileDiffQueryData,
    InboxQueryData,
    PullRequestCommitsQueryData,
    PullRequestDetailQueryData,
    PullRequestFilesQueryData,
    RelatedPullRequestsQueryData,
    RepositoriesQueryData,
    RepositoryMetadataQueryData,
    ReviewThreadsQueryData,
} from "#/lib/query/types.ts";
import type { SuggestionChange } from "#/lib/session/apply-suggestion.ts";
import type { SessionError } from "#/lib/session/errors.ts";
import type {
    InboxSection,
    InboxSectionExport,
    InboxSectionId,
    InboxSectionLayoutEntry,
    InboxSettings,
    SectionColorId,
    SectionIconId,
} from "#/lib/session/inbox-sections.ts";
import type { GithubClient, GithubViewer, InboxPullRequestPageInfo, KeyValueStore } from "#/lib/session/ports.ts";
import type { SectionFilter, SectionRecipeId } from "#/lib/session/section-filters.ts";
import type {
    DiffSide,
    FileDiff,
    MergeMethod,
    MergePullRequestOptions,
    StackMergePullRequestOptions,
    PendingLineComment,
    PullRequestComment,
    PullRequestCommit,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    PullRequestTimelineItem,
    Repository,
    RepositoryLabel,
    RepositoryUser,
    ReactionContent,
    ReactionGroup,
    ReviewDraft,
    ReviewEvent,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import {
    emptyInboxQueryData,
    fetchInboxSections,
    mergePullRequestSummaries,
    mergeSectionResultsIntoInbox,
    patchInboxPullRequest,
    sectionCountAfterClientFilter,
} from "#/lib/query/inbox-fetch.ts";
import {
    getInboxQueryData,
    inboxSectionQueryKey,
    inboxSectionQueryPrefix,
    setInboxQueryData,
} from "#/lib/query/inbox.ts";
import { invalidateInboxForRefresh, invalidatePullRequestSecondaryAfterMutation } from "#/lib/query/invalidate.ts";
import { setPullRequestDetailQueryData } from "#/lib/query/pull-request.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { EasyReviewError, missingToken, toSessionError, unauthorized } from "#/lib/session/errors.ts";
import {
    defaultExpandedSections,
    defaultLabelForSection,
    defaultSectionLayout,
    INBOX_SECTION_LOAD_SIZE,
    inboxSectionsFromLoaded,
    INBOX_SETTINGS_VERSION,
    isPresetInboxSectionId,
    newCustomSectionId,
    normalizeHexColor,
    normalizeSectionLayout,
    parseInboxSectionExport,
    parseInboxSettings,
    visibleSectionDefinitions,
} from "#/lib/session/inbox-sections.ts";
import {
    comparePullRequestsByUpdatedAtDesc,
    matchesPullRequestSearchQuery,
    parsePullRequestUrl,
} from "#/lib/session/pull-request-search.ts";
import { resolveGithubPullRequestStack, type ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import { selectRelatedPullRequests } from "#/lib/session/related-pull-requests.ts";
import { sectionFilterToSearchQuery } from "#/lib/session/section-filters.ts";
import {
    defaultFilterForPreset,
    emptySectionFilter,
    filterFromRecipe,
    matchSectionFilter,
    normalizeSectionFilter,
    recipeById,
} from "#/lib/session/section-filters.ts";
import { evaluateStackMerge } from "#/lib/session/stack-merge.ts";
import { areStacksEnabled, getStackPreferences } from "#/lib/stack-preferences.ts";

/** Pre-OAuth localStorage key — removed on restore/disconnect so leftovers cannot leak. */
const LEGACY_BROWSER_TOKEN_KEY = "auth:token";
const SELECTED_REPOS_KEY = "repos:selected";
const REPOS_CACHE_KEY = "repos:cache";
/** Login the persisted repository preferences belong to. */
const REPOS_ACCOUNT_KEY = "repos:account";
/** Set on explicit sign-out so an expired session auto-reconnects but a deliberate logout shows the connect screen. */
const SIGNED_OUT_KEY = "auth:signed-out";
const INBOX_CACHE_KEY = "inbox:cache";
const INBOX_EXPANDED_KEY = "inbox:expanded";
const INBOX_SECTIONS_KEY = "inbox:sections";
/** Background tab-focus revalidates skip if the inbox was refreshed more recently than this. */
const INBOX_BACKGROUND_REVALIDATE_MIN_MS = CACHE_POLICY.inbox.backgroundRevalidateMinMs;
/** Index of every persisted draft key so disconnect can wipe them without a store scan. */
const DRAFT_INDEX_KEY = "review-drafts:index";

function draftStorageKey(login: string, repository: string, number: number): string {
    return `review-draft:${login}:${repository}#${number}`;
}

const DEFAULT_EXPANDED_SECTIONS: Array<InboxSectionId> = defaultExpandedSections();

export type AuthStatus = "restoring" | "unauthenticated" | "verifying" | "authenticated";

export type AuthState = {
    status: AuthStatus;
    viewer: GithubViewer | null;
    /** True when a GitHub credential is established (OAuth cookie or in-memory test/fixture). */
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
    /** Rows loaded per visible section (initially {@link INBOX_SECTION_LOAD_SIZE}). */
    sectionPullRequests: Record<string, Array<PullRequestSummary>>;
    /** GitHub search pagination per section. */
    sectionPagination: Record<string, InboxPullRequestPageInfo>;
    /** Section currently fetching the next page from GitHub, if any. */
    loadingMoreSection: InboxSectionId | null;
    expandedSections: Array<InboxSectionId>;
    /** Hide / rename / reorder preferences for the triage board. */
    sectionLayout: Array<InboxSectionLayoutEntry>;
    /** Exact totals from GitHub search per section. */
    sectionCounts: Record<string, number>;
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

export type ConversationCommentsState = {
    status: "idle" | "loading" | "ready" | "error";
    /** Full PR timeline (comments, commits, assignments, …). */
    items: Array<PullRequestTimelineItem>;
    error: SessionError | null;
};

export type PullRequestCommitsState = {
    status: "idle" | "loading" | "ready" | "error";
    items: Array<PullRequestCommit>;
    error: SessionError | null;
};

export type RelatedPullRequestsState = {
    status: "idle" | "loading" | "ready" | "error";
    items: Array<PullRequestSummary>;
    headRefName: string | null;
    baseRefName: string | null;
    error: SessionError | null;
};

export type PullRequestStackState = {
    status: "idle" | "loading" | "ready" | "error";
    stack: ResolvedPullRequestStack | null;
    error: SessionError | null;
};

export type RepositoryMetadataState = {
    status: "idle" | "loading" | "ready" | "error";
    users: Array<RepositoryUser>;
    labels: Array<RepositoryLabel>;
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
    /** Conversation (issue) comments keyed by `owner/repo#number`. */
    conversationComments: Record<string, ConversationCommentsState>;
    /** Commits tab list keyed by `owner/repo#number`. */
    pullRequestCommits: Record<string, PullRequestCommitsState>;
    /** Cross-repo siblings sharing head+base, keyed by `owner/repo#number`. */
    relatedPullRequests: Record<string, RelatedPullRequestsState>;
    /** Assignable users + labels keyed by `owner/repo`. */
    repositoryMetadata: Record<string, RepositoryMetadataState>;
};

export type EasyReviewSessionDeps = {
    github: GithubClient;
    queryClient: QueryClient;
    store: KeyValueStore;
    /**
     * When set, `restore` probes GitHub with a session credential (OAuth cookie + same-origin
     * proxy) instead of a client-stored secret. `logout` clears the server session.
     */
    oauth?: {
        /** Sentinel passed to `GithubClient` methods; the proxy attaches the real token. */
        sessionCredential: string;
        logout: () => Promise<void>;
        /** Start the GitHub OAuth redirect (e.g. `location.assign("/api/auth/github")`). */
        beginLogin: () => void;
    };
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
    sectionPullRequests: {},
    sectionPagination: {},
    loadingMoreSection: null,
    expandedSections: DEFAULT_EXPANDED_SECTIONS,
    sectionLayout: defaultSectionLayout(),
    sectionCounts: {},
    error: null,
    lastLoadedAt: null,
};

function pullRequestSummaryNeedsHydration(pullRequest: PullRequestSummary): boolean {
    return (
        pullRequest.reviewers.length === 0 &&
        pullRequest.reviewRequests.length === 0 &&
        pullRequest.checks === "none" &&
        pullRequest.commentCount === 0 &&
        pullRequest.reviewDecision === null &&
        pullRequest.mergeable === "unknown"
    );
}

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
    sectionPullRequests?: Record<string, Array<PullRequestSummary>>;
    sectionCounts?: Record<string, number>;
    lastLoadedAt: string | null;
};

/**
 * The single application port the UI talks to. It owns credentials, browser persistence and
 * every GitHub interaction, so behaviour can be tested without a DOM or a real GitHub.
 */
export function createEasyReviewSession({ github, queryClient, store, oauth }: EasyReviewSessionDeps) {
    const initialThreadsState: ReviewThreadsState = { status: "idle", items: [], error: null };
    const initialConversationState: ConversationCommentsState = { status: "idle", items: [], error: null };
    const initialCommitsState: PullRequestCommitsState = { status: "idle", items: [], error: null };
    const initialRelatedState: RelatedPullRequestsState = {
        status: "idle",
        items: [],
        headRefName: null,
        baseRefName: null,
        error: null,
    };
    const initialRepositoryMetadata: RepositoryMetadataState = {
        status: "idle",
        users: [],
        labels: [],
        error: null,
    };

    const state = new Store<SessionState>({
        auth: initialAuthState,
        repos: initialRepositoriesState,
        inbox: initialInboxState,
        pullRequests: {},
        reviewDrafts: {},
        reviewThreads: {},
        conversationComments: {},
        pullRequestCommits: {},
        relatedPullRequests: {},
        repositoryMetadata: {},
    });

    /** The verified credential, kept out of the reactive state so the UI can never render it. */
    let token: string | null = null;

    /**
     * Only the most recent credential check may write to state. Anything slower — a superseded
     * connect, a cancelled replacement, a request that lands after disconnect — is discarded.
     */
    let latestAuthAttempt = 0;
    let latestRepositoryLoad = 0;
    let latestInboxLoad = 0;
    /** The same rule per pull request, since several pages can be opened in one tab's history. */
    const latestPullRequestLoads = new Map<string, number>();
    const latestFileListLoads = new Map<string, number>();
    const latestFileDiffLoads = new Map<string, number>();
    const latestReviewThreadLoads = new Map<string, number>();
    const latestConversationCommentLoads = new Map<string, number>();
    const latestPullRequestCommitLoads = new Map<string, number>();
    const latestRelatedPullRequestLoads = new Map<string, number>();
    const latestRepositoryMetadataLoads = new Map<string, number>();
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

    function currentInboxQueryContext(): { login: string } | null {
        const login = state.state.auth.viewer?.login;
        if (!login) {
            return null;
        }

        return { login };
    }

    function readInboxQueryData(): InboxQueryData {
        const context = currentInboxQueryContext();
        if (!context) {
            return emptyInboxQueryData();
        }

        return getInboxQueryData(queryClient, context.login) ?? emptyInboxQueryData();
    }

    function syncInboxQueryData(data: InboxQueryData): void {
        const context = currentInboxQueryContext();
        if (context) {
            setInboxQueryData(queryClient, context.login, data);
        }

        setInbox({
            pullRequests: data.pullRequests,
            sectionPullRequests: data.sectionPullRequests,
            sectionCounts: data.sectionCounts,
            sectionPagination: data.sectionPagination,
            lastLoadedAt: data.lastLoadedAt,
        });
    }

    function syncInboxFromStore(): void {
        const { inbox } = state.state;
        syncInboxQueryData({
            pullRequests: inbox.pullRequests,
            sectionPullRequests: inbox.sectionPullRequests,
            sectionCounts: inbox.sectionCounts,
            sectionPagination: inbox.sectionPagination,
            lastLoadedAt: inbox.lastLoadedAt,
        });
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

    /** Cancels in-flight PR loads and empties the in-memory workspace (not the persisted store). */
    function resetSessionUi(): void {
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

        for (const [key, attempt] of latestRelatedPullRequestLoads) {
            latestRelatedPullRequestLoads.set(key, attempt + 1);
        }

        setRepos({ ...initialRepositoriesState });
        setInbox({ ...initialInboxState });
        state.setState((prev) => ({
            ...prev,
            pullRequests: {},
            reviewDrafts: {},
            reviewThreads: {},
            conversationComments: {},
            pullRequestCommits: {},
            relatedPullRequests: {},
            repositoryMetadata: {},
        }));
    }

    /** Drops everything that describes one account's work: repos, allowlist, cached Inbox. */
    async function forgetAccountData(): Promise<void> {
        resetSessionUi();
        await Promise.all([
            store.remove(SELECTED_REPOS_KEY),
            store.remove(REPOS_CACHE_KEY),
            store.remove(REPOS_ACCOUNT_KEY),
            store.remove(INBOX_CACHE_KEY),
            store.remove(INBOX_EXPANDED_KEY),
            store.remove(INBOX_SECTIONS_KEY),
            clearDraftStorage(),
        ]);
    }

    /**
     * Preferences belong to one GitHub account. Signing in as someone else starts from a clean
     * allowlist rather than showing them the previous account's repos and pull requests.
     */
    async function loadAccountPreferences(login: string): Promise<void> {
        const account = await store.get(REPOS_ACCOUNT_KEY);

        if (account !== login) {
            await forgetAccountData();
            await store.set(REPOS_ACCOUNT_KEY, login);
            return;
        }

        const [selected, repositories, inbox, sections] = await Promise.all([
            readJson<Array<string>>(SELECTED_REPOS_KEY),
            readJson<RepositoriesCache>(REPOS_CACHE_KEY),
            readJson<InboxCache>(INBOX_CACHE_KEY),
            readJson<Array<InboxSectionLayoutEntry>>(INBOX_SECTIONS_KEY),
        ]);

        // Live expand/collapse is tab-session memory only; drop any legacy persisted copy.
        void store.remove(INBOX_EXPANDED_KEY);

        const sectionLayout = normalizeSectionLayout(sections);

        setRepos({
            selected: selected ?? [],
            available: repositories?.available ?? [],
            lastLoadedAt: repositories?.lastLoadedAt ?? null,
            status: repositories?.available.length ? "ready" : "idle",
        });

        setInbox({
            pullRequests: inbox?.pullRequests ?? [],
            sectionPullRequests: inbox?.sectionPullRequests ?? {},
            sectionCounts: inbox?.sectionCounts ?? {},
            lastLoadedAt: inbox?.lastLoadedAt ?? null,
            status: inbox?.pullRequests.length ? "ready" : "idle",
            // Force a GitHub refresh after sign-in / session restore (cache is only for instant paint).
            stale: true,
            expandedSections: defaultExpandedSections(sectionLayout),
            sectionLayout,
        });

        if (login && inbox) {
            setInboxQueryData(queryClient, login, {
                pullRequests: inbox.pullRequests,
                sectionPullRequests: inbox.sectionPullRequests ?? {},
                sectionCounts: inbox.sectionCounts ?? {},
                sectionPagination: {},
                lastLoadedAt: inbox.lastLoadedAt,
            });
        }

        if (login && repositories) {
            queryClient.setQueryData<RepositoriesQueryData>(queryKeys.repos.list(login), {
                available: repositories.available,
                lastLoadedAt: repositories.lastLoadedAt,
            });
        }
    }

    /**
     * Probe the OAuth session cookie via the proxy (production), or settle unauthenticated
     * (tests call `connect` instead). Always drops any pre-OAuth browser-stored secret.
     */
    async function restore(): Promise<void> {
        const attempt = ++latestAuthAttempt;
        await store.remove(LEGACY_BROWSER_TOKEN_KEY);

        if (attempt !== latestAuthAttempt) {
            return;
        }

        if (!oauth) {
            setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
            return;
        }

        const candidate = oauth.sessionCredential;
        setAuth({ tokenStored: true });

        try {
            const viewer = await github.getViewer(candidate);
            if (attempt !== latestAuthAttempt) return;
            token = candidate;
            await store.remove(SIGNED_OUT_KEY);
            await loadAccountPreferences(viewer.login);
            setAuth({ status: "authenticated", viewer, error: null });
        } catch (error) {
            if (attempt !== latestAuthAttempt) return;
            const sessionError = toSessionError(error);
            // Missing/expired cookie → reconnect when this browser already had an account.
            if (sessionError.kind === "unauthorized") {
                if (await tryAutoReconnectAfterExpiredSession()) {
                    return;
                }
                setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
                return;
            }

            setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: sessionError });
        }
    }

    async function tryAutoReconnectAfterExpiredSession(): Promise<boolean> {
        if (!oauth || !shouldAutoReconnectAfterUnauthorized()) {
            return false;
        }

        const [hadAccount, signedOut] = await Promise.all([store.get(REPOS_ACCOUNT_KEY), store.get(SIGNED_OUT_KEY)]);
        if (!hadAccount || signedOut) {
            return false;
        }

        setAuth({ status: "verifying", error: null });
        oauth.beginLogin();
        return true;
    }

    function shouldAutoReconnectAfterUnauthorized(): boolean {
        const search = typeof globalThis.location?.search === "string" ? globalThis.location.search : "";
        return !new URLSearchParams(search).has("authError");
    }

    /**
     * Validate a credential and keep it in memory only (tests / `VITE_FAKE_GITHUB` fixtures).
     * Production auth goes through OAuth — never store secrets in the browser.
     */
    async function connect(candidate: string): Promise<void> {
        const trimmed = candidate.trim();

        if (!trimmed) {
            setAuth({
                error: {
                    kind: "unauthorized",
                    message: "Sign in with GitHub to continue.",
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
            await store.remove(LEGACY_BROWSER_TOKEN_KEY);
            await store.remove(SIGNED_OUT_KEY);
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

    /** Redirect the browser into the GitHub OAuth authorize flow. */
    function beginOAuthLogin(): void {
        if (!oauth) {
            throw new Error("OAuth login is not configured for this session.");
        }

        setAuth({ status: "verifying", error: null });
        oauth.beginLogin();
    }

    /** Apply an OAuth callback error surfaced via `?authError=` on the connect screen. */
    function reportAuthError(message: string): void {
        setAuth({
            status: "unauthenticated",
            viewer: null,
            tokenStored: false,
            error: { kind: "unauthorized", message },
        });
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
     * Sign out and clear the in-memory workspace. Persisted allowlist / Inbox layout / drafts stay
     * so the same GitHub login can reconnect without re-setup. A different login still wipes them
     * in `loadAccountPreferences`.
     */
    async function disconnect(): Promise<void> {
        latestAuthAttempt++;
        latestRepositoryLoad++;
        latestInboxLoad++;
        latestPullRequestLoads.forEach((_value, key) => {
            latestPullRequestLoads.set(key, (latestPullRequestLoads.get(key) ?? 0) + 1);
        });
        token = null;
        if (oauth) {
            try {
                await oauth.logout();
            } catch {
                // Local wipe still proceeds if the logout endpoint is unreachable.
            }
        }
        await store.remove(LEGACY_BROWSER_TOKEN_KEY);
        await store.set(SIGNED_OUT_KEY, "1");
        queryClient.removeQueries({ queryKey: ["pullRequest"] });
        resetSessionUi();
        setAuth({ status: "unauthenticated", viewer: null, tokenStored: false, error: null });
    }

    function dismissError(): void {
        setAuth({ error: null });
    }

    /** Ask GitHub which repositories this session can see. */
    async function refreshRepositories(): Promise<void> {
        const attempt = ++latestRepositoryLoad;
        const login = state.state.auth.viewer?.login;
        const cached =
            (login ? queryClient.getQueryData<RepositoriesQueryData>(queryKeys.repos.list(login)) : undefined)
                ?.available ?? state.state.repos.available;
        setRepos({ refreshing: true, status: cached.length ? "ready" : "loading", error: null });

        try {
            if (!login) {
                throw unauthorized("Not signed in.");
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.repos.list(login) });
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.repos.list(login),
                queryFn: async () => {
                    const available = await github.listRepositories(requireToken());
                    return { available, lastLoadedAt: new Date().toISOString() } satisfies RepositoriesQueryData;
                },
            });

            if (attempt !== latestRepositoryLoad) return;

            await store.set(
                REPOS_CACHE_KEY,
                JSON.stringify({
                    available: data.available,
                    lastLoadedAt: data.lastLoadedAt,
                } satisfies RepositoriesCache),
            );
            setRepos({
                status: "ready",
                refreshing: false,
                available: data.available,
                lastLoadedAt: data.lastLoadedAt,
                error: null,
            });
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

    /** Load the first page of pull requests and total count for each section. */
    async function loadInboxSections(
        sectionIds?: ReadonlyArray<InboxSectionId>,
        attempt?: number,
    ): Promise<{ successes: number; failure: SessionError | null }> {
        const { repos, auth, inbox } = state.state;
        const viewerLogin = auth.viewer?.login;
        const selected = repos.selected;

        if (!viewerLogin || selected.length === 0) {
            if (attempt === undefined || attempt === latestInboxLoad) {
                syncInboxQueryData(emptyInboxQueryData());
            }
            return { successes: 0, failure: null };
        }

        if (attempt !== undefined && attempt !== latestInboxLoad) {
            return { successes: 0, failure: null };
        }

        const existing = readInboxQueryData();
        const { data, successes, failure } = await fetchInboxSections({
            github,
            token: requireToken(),
            viewerLogin,
            selected,
            sectionLayout: inbox.sectionLayout,
            existing,
            sectionIds,
            onSectionLoaded: (result) => {
                if (attempt !== undefined && attempt !== latestInboxLoad) {
                    return;
                }

                let merged = emptyInboxQueryData();
                setInboxQueryData(queryClient, viewerLogin, (current) => {
                    merged = mergeSectionResultsIntoInbox(current ?? emptyInboxQueryData(), [result]);
                    return merged;
                });
                syncInboxQueryData(merged);
                queryClient.setQueryData(inboxSectionQueryKey(viewerLogin, result.id), {
                    sectionId: result.id,
                    pullRequests: result.pullRequests,
                    totalCount: result.totalCount,
                    pageInfo: result.pageInfo,
                    lastLoadedAt: merged.lastLoadedAt,
                });
            },
        });

        if (attempt !== undefined && attempt !== latestInboxLoad) {
            return { successes, failure };
        }

        if (successes === 0) {
            return { successes, failure };
        }

        syncInboxQueryData(data);

        return { successes, failure };
    }

    async function ensureInboxSectionLoaded(sectionId: InboxSectionId): Promise<void> {
        const { inbox } = state.state;
        const pullRequests = inbox.sectionPullRequests[sectionId] ?? [];

        if (inbox.refreshing) {
            return;
        }

        if (!(sectionId in inbox.sectionCounts) || pullRequests.some(pullRequestSummaryNeedsHydration)) {
            await loadInboxSections([sectionId]);
        }
    }

    /** Refresh every section from GitHub ({@link INBOX_SECTION_LOAD_SIZE} rows + total count each). */
    async function refreshInbox(): Promise<void> {
        const attempt = ++latestInboxLoad;
        const context = currentInboxQueryContext();
        const cached = readInboxQueryData();

        if (!context || state.state.repos.selected.length === 0) {
            setInbox({
                status: "ready",
                refreshing: false,
                stale: false,
                pullRequests: [],
                sectionPullRequests: {},
                sectionCounts: {},
                sectionPagination: {},
                loadingMoreSection: null,
                error: null,
            });
            syncInboxQueryData(emptyInboxQueryData());
            return;
        }

        const keepPainted = state.state.inbox.status === "ready" || cached.pullRequests.length > 0;
        setInbox({ refreshing: true, status: keepPainted ? "ready" : "loading", error: null });

        try {
            await queryClient.invalidateQueries({ queryKey: inboxSectionQueryPrefix(context.login) });

            const { successes, failure } = await loadInboxSections(undefined, attempt);

            if (attempt !== latestInboxLoad) return;

            if (successes === 0 && failure) {
                throw new EasyReviewError(failure.kind, failure.message, { retryAt: failure.retryAt });
            }

            const data = readInboxQueryData();
            await store.set(
                INBOX_CACHE_KEY,
                JSON.stringify({
                    pullRequests: data.pullRequests,
                    sectionPullRequests: data.sectionPullRequests,
                    sectionCounts: data.sectionCounts,
                    lastLoadedAt: data.lastLoadedAt,
                } satisfies InboxCache),
            );
            setInbox({
                status: "ready",
                refreshing: false,
                stale: false,
                loadingMoreSection: null,
                lastLoadedAt: data.lastLoadedAt,
                error: null,
            });
        } catch (error) {
            if (attempt !== latestInboxLoad) return;
            setInbox({
                status: cached.pullRequests.length ? "ready" : "error",
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
     * Called on tab focus and on the quiet 3-minute interval.
     * Pass `{ background: true }` to skip when the inbox was refreshed recently.
     * Never runs while a refresh is already in flight.
     */
    async function revalidateInbox(options?: { background?: boolean }): Promise<void> {
        if (state.state.inbox.refreshing) {
            return;
        }

        if (options?.background) {
            const inboxData = readInboxQueryData();
            const lastLoadedAt = inboxData.lastLoadedAt ?? state.state.inbox.lastLoadedAt;
            if (lastLoadedAt && Date.now() - Date.parse(lastLoadedAt) < INBOX_BACKGROUND_REVALIDATE_MIN_MS) {
                return;
            }
        }

        await refreshInbox();
    }

    /** Mark the inbox dirty so the next Inbox visit / loadInbox picks up a fresh GitHub fetch. */
    function invalidateInbox(): void {
        setInbox({ stale: true });
        const context = currentInboxQueryContext();
        if (context) {
            invalidateInboxForRefresh(queryClient, context.login);
        }
    }

    async function persistInboxPullRequests(pullRequests: Array<PullRequestSummary>): Promise<void> {
        const lastLoadedAt = new Date().toISOString();
        await store.set(INBOX_CACHE_KEY, JSON.stringify({ pullRequests, lastLoadedAt } satisfies InboxCache));
        setInbox({ pullRequests, lastLoadedAt });
    }

    function sectionLayoutEntry(id: InboxSectionId): InboxSectionLayoutEntry | undefined {
        return state.state.inbox.sectionLayout.find((entry) => entry.id === id);
    }

    function canLoadMoreInboxSection(sectionId: InboxSectionId): boolean {
        const inboxData = readInboxQueryData();
        const loaded = inboxData.sectionPullRequests[sectionId]?.length ?? 0;
        const total = inboxData.sectionCounts[sectionId];

        if (total !== undefined) {
            return loaded < total;
        }

        return inboxData.sectionPagination[sectionId]?.hasNextPage === true;
    }

    /** Fetch the next page of pull requests for one section. */
    async function loadMoreInboxSection(sectionId: InboxSectionId): Promise<void> {
        const entry = sectionLayoutEntry(sectionId);
        const viewerLogin = state.state.auth.viewer?.login;
        const { selected } = state.state.repos;
        const { inbox } = state.state;

        if (!entry || !viewerLogin || inbox.loadingMoreSection !== null || !canLoadMoreInboxSection(sectionId)) {
            return;
        }

        const query = sectionFilterToSearchQuery(entry.filter, viewerLogin);

        setInbox({ loadingMoreSection: sectionId, error: null });

        try {
            const inboxData = readInboxQueryData();
            const loaded = inboxData.sectionPullRequests[sectionId] ?? [];

            if (!query) {
                const selectedSet = new Set(selected);
                const matched = inboxData.pullRequests
                    .filter(
                        (pullRequest) =>
                            selectedSet.has(pullRequest.repository) &&
                            matchSectionFilter(pullRequest, entry.filter, viewerLogin),
                    )
                    .sort(comparePullRequestsByUpdatedAtDesc);
                const offset = loaded.length;
                const nextOffset = Math.min(matched.length, offset + INBOX_SECTION_LOAD_SIZE);
                const pullRequests = matched.slice(0, nextOffset);

                setInbox({
                    sectionPullRequests: { ...state.state.inbox.sectionPullRequests, [sectionId]: pullRequests },
                    sectionCounts: { ...state.state.inbox.sectionCounts, [sectionId]: matched.length },
                    sectionPagination: {
                        ...state.state.inbox.sectionPagination,
                        [sectionId]: {
                            hasNextPage: nextOffset < matched.length,
                            endCursor: nextOffset < matched.length ? String(nextOffset) : null,
                        },
                    },
                    loadingMoreSection: null,
                    error: null,
                });
                syncInboxFromStore();
                return;
            }

            const page = await github.fetchSectionPullRequests(requireToken(), {
                query,
                repositories: selected,
                limit: INBOX_SECTION_LOAD_SIZE,
                after: inboxData.sectionPagination[sectionId]?.endCursor,
            });

            const incoming = page.pullRequests.filter((pullRequest) =>
                matchSectionFilter(pullRequest, entry.filter, viewerLogin),
            );
            const pullRequests = mergePullRequestSummaries(loaded, incoming);
            const mergedPool = mergePullRequestSummaries(inboxData.pullRequests, incoming);

            setInbox({
                sectionPullRequests: { ...state.state.inbox.sectionPullRequests, [sectionId]: pullRequests },
                sectionCounts: {
                    ...state.state.inbox.sectionCounts,
                    [sectionId]: sectionCountAfterClientFilter({
                        githubTotal: page.totalCount,
                        fetchedOnThisPage: page.pullRequests.length,
                        matchingOnThisPage: incoming.length,
                        matchingLoaded: pullRequests.length,
                        hasNextPage: page.pageInfo.hasNextPage,
                    }),
                },
                sectionPagination: { ...state.state.inbox.sectionPagination, [sectionId]: page.pageInfo },
                pullRequests: mergedPool,
                loadingMoreSection: null,
                error: null,
            });
            syncInboxFromStore();
            await persistInboxPullRequests(mergedPool);
        } catch (error) {
            setInbox({
                loadingMoreSection: null,
                error: toSessionError(error),
            });
        }
    }

    async function toggleSection(id: InboxSectionId): Promise<void> {
        const { expandedSections } = state.state.inbox;
        const isExpanded = expandedSections.includes(id);
        const next = isExpanded ? expandedSections.filter((section) => section !== id) : [...expandedSections, id];

        // In-memory for this tab only — reload uses "Expanded by default" from section settings.
        setInbox({ expandedSections: next });

        if (!isExpanded) {
            await ensureInboxSectionLoaded(id);
        }
    }

    async function persistSectionLayout(layout: Array<InboxSectionLayoutEntry>): Promise<void> {
        const normalized = normalizeSectionLayout(layout);
        setInbox({ sectionLayout: normalized });
        await store.set(INBOX_SECTIONS_KEY, JSON.stringify(normalized));
    }

    function getSectionLayout(): Array<InboxSectionLayoutEntry> {
        return state.state.inbox.sectionLayout;
    }

    async function setSectionHidden(id: InboxSectionId, hidden: boolean): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) => (entry.id === id ? { ...entry, hidden } : entry)),
        );

        if (!hidden) {
            await ensureInboxSectionLoaded(id);
        }
    }

    async function setSectionLabel(id: InboxSectionId, label: string): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) => (entry.id === id ? { ...entry, label } : entry)),
        );
    }

    async function setSectionColor(id: InboxSectionId, color: SectionColorId): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) =>
                entry.id === id ? { ...entry, color, customColor: null } : entry,
            ),
        );
    }

    async function setSectionCustomColor(id: InboxSectionId, customColor: string): Promise<void> {
        const hex = normalizeHexColor(customColor);
        if (!hex) {
            return;
        }

        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) => (entry.id === id ? { ...entry, customColor: hex } : entry)),
        );
    }

    async function setSectionIcon(id: InboxSectionId, icon: SectionIconId): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) => (entry.id === id ? { ...entry, icon } : entry)),
        );
    }

    async function setSectionDefaultExpanded(id: InboxSectionId, defaultExpanded: boolean): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) => (entry.id === id ? { ...entry, defaultExpanded } : entry)),
        );
    }

    async function moveSection(id: InboxSectionId, direction: "up" | "down"): Promise<void> {
        const layout = [...state.state.inbox.sectionLayout];
        const visibleIndexes = layout.flatMap((entry, index) => (entry.hidden ? [] : [index]));
        const visiblePos = visibleIndexes.findIndex((index) => layout[index]?.id === id);
        if (visiblePos < 0) {
            return;
        }

        const swapPos = direction === "up" ? visiblePos - 1 : visiblePos + 1;
        if (swapPos < 0 || swapPos >= visibleIndexes.length) {
            return;
        }

        const from = visibleIndexes[visiblePos]!;
        const to = visibleIndexes[swapPos]!;
        const current = layout[from]!;
        layout[from] = layout[to]!;
        layout[to] = current;
        await persistSectionLayout(layout);
    }

    /** Reorder a visible section to a new index among visible sections (hidden rows stay put). */
    async function reorderVisibleSection(id: InboxSectionId, toVisibleIndex: number): Promise<void> {
        const layout = state.state.inbox.sectionLayout;
        const visible = layout.filter((entry) => !entry.hidden);
        const fromVisibleIndex = visible.findIndex((entry) => entry.id === id);
        if (
            fromVisibleIndex < 0 ||
            toVisibleIndex < 0 ||
            toVisibleIndex >= visible.length ||
            fromVisibleIndex === toVisibleIndex
        ) {
            return;
        }

        const nextVisible = [...visible];
        const [moved] = nextVisible.splice(fromVisibleIndex, 1);
        if (!moved) {
            return;
        }
        nextVisible.splice(toVisibleIndex, 0, moved);

        let visibleCursor = 0;
        await persistSectionLayout(layout.map((entry) => (entry.hidden ? entry : nextVisible[visibleCursor++]!)));
    }

    async function resetSectionLayout(): Promise<void> {
        const layout = defaultSectionLayout();
        await persistSectionLayout(layout);
        setInbox({ expandedSections: defaultExpandedSections(layout) });
    }

    async function setSectionFilter(id: InboxSectionId, filter: SectionFilter): Promise<void> {
        await persistSectionLayout(
            state.state.inbox.sectionLayout.map((entry) =>
                entry.id === id ? { ...entry, filter: normalizeSectionFilter(filter, entry.filter) } : entry,
            ),
        );
        await loadInboxSections([id]);
    }

    async function resetSectionFilter(id: InboxSectionId): Promise<void> {
        const filter = isPresetInboxSectionId(id) ? defaultFilterForPreset(id) : emptySectionFilter();
        await setSectionFilter(id, filter);
    }

    async function addCustomSection(recipeId: SectionRecipeId): Promise<InboxSectionId> {
        const recipe = recipeById(recipeId);
        const id = newCustomSectionId();
        const entry: InboxSectionLayoutEntry = {
            id,
            label: recipe?.suggestedLabel ?? "Custom section",
            hidden: false,
            defaultExpanded: true,
            color: recipe?.color ?? "muted",
            customColor: null,
            icon: recipe?.icon ?? "filter",
            filter: filterFromRecipe(recipeId),
            kind: "custom",
        };
        const layout = [...state.state.inbox.sectionLayout, entry];
        await persistSectionLayout(layout);
        setInbox({ expandedSections: [...state.state.inbox.expandedSections, id] });
        return id;
    }

    async function duplicateSection(id: InboxSectionId): Promise<InboxSectionId | null> {
        const source = state.state.inbox.sectionLayout.find((entry) => entry.id === id);
        if (!source) {
            return null;
        }
        const newId = newCustomSectionId();
        const entry: InboxSectionLayoutEntry = {
            ...source,
            id: newId,
            label: `${source.label.trim() || defaultLabelForSection(source.id)} copy`,
            hidden: false,
            kind: "custom",
            filter: normalizeSectionFilter(source.filter),
        };
        const index = state.state.inbox.sectionLayout.findIndex((row) => row.id === id);
        const layout = [...state.state.inbox.sectionLayout];
        layout.splice(index + 1, 0, entry);
        await persistSectionLayout(layout);
        return newId;
    }

    async function deleteSection(id: InboxSectionId): Promise<void> {
        const entry = state.state.inbox.sectionLayout.find((row) => row.id === id);
        if (!entry || entry.kind === "preset") {
            return;
        }
        await persistSectionLayout(state.state.inbox.sectionLayout.filter((row) => row.id !== id));
        setInbox({
            expandedSections: state.state.inbox.expandedSections.filter((sectionId) => sectionId !== id),
        });
    }

    function getInboxSettings(): InboxSettings {
        return {
            version: INBOX_SETTINGS_VERSION,
            expandedSections: defaultExpandedSections(state.state.inbox.sectionLayout),
            sectionLayout: state.state.inbox.sectionLayout,
        };
    }

    function exportInboxSection(id: InboxSectionId): InboxSectionExport | null {
        const section = state.state.inbox.sectionLayout.find((entry) => entry.id === id);
        if (!section) {
            return null;
        }
        return { version: INBOX_SETTINGS_VERSION, section };
    }

    async function importInboxSettings(raw: unknown): Promise<void> {
        const settings = parseInboxSettings(raw);
        setInbox({
            expandedSections: defaultExpandedSections(settings.sectionLayout),
            sectionLayout: settings.sectionLayout,
        });
        await Promise.all([
            store.remove(INBOX_EXPANDED_KEY),
            store.set(INBOX_SECTIONS_KEY, JSON.stringify(settings.sectionLayout)),
        ]);
    }

    async function importInboxSection(raw: unknown): Promise<InboxSectionId> {
        const { section } = parseInboxSectionExport(raw);
        const layout = [...state.state.inbox.sectionLayout, section];
        await persistSectionLayout(layout);
        setInbox({ expandedSections: [...state.state.inbox.expandedSections, section.id] });
        return section.id;
    }

    /** Match preview against the current inbox pool (selected repos only). */
    function previewSectionFilter(
        filter: SectionFilter,
        sampleSize = 8,
    ): {
        count: number;
        sample: Array<PullRequestSummary>;
    } {
        const { inbox, repos, auth } = state.state;
        const selected = new Set(repos.selected);
        const viewerLogin = auth.viewer?.login ?? "";
        const matched = inbox.pullRequests
            .filter((pullRequest) => selected.has(pullRequest.repository))
            .filter((pullRequest) => matchSectionFilter(pullRequest, filter, viewerLogin))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return { count: matched.length, sample: matched.slice(0, sampleSize) };
    }

    /** Ask GitHub for one pull request in full. */
    async function refreshPullRequest(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestPullRequestLoads.get(key) ?? 0) + 1;
        latestPullRequestLoads.set(key, attempt);

        const cached = resolvePullRequestDetail(repository, number);
        const keepPainted = cached != null || state.state.pullRequests[key]?.status === "ready";
        setPullRequest(key, { refreshing: true, status: keepPainted ? "ready" : "loading", error: null });

        try {
            await queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.detail(key) });
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.detail(key),
                queryFn: async () => {
                    const detail = await github.getPullRequest(requireToken(), repository, number);
                    return { detail, lastLoadedAt: new Date().toISOString() };
                },
            });
            if (attempt !== latestPullRequestLoads.get(key)) return;
            if (state.state.auth.status !== "authenticated") {
                queryClient.removeQueries({ queryKey: queryKeys.pullRequest.detail(key) });
                return;
            }

            setPullRequest(key, {
                status: "ready",
                refreshing: false,
                detail: data.detail,
                lastLoadedAt: data.lastLoadedAt,
                error: null,
            });
            await syncDraftWithHead(data.detail);
            await refreshSecondaryPullRequestViews(repository, number);
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
        const key = pullRequestKey(repository, number);
        const view = state.state.pullRequests[key];

        if (view?.refreshing) {
            return;
        }

        if (view?.status === "ready" || resolvePullRequestDetail(repository, number)) {
            return;
        }

        await refreshPullRequest(repository, number);
    }

    /** Called on tab focus while a pull request is open, manual refresh, and the 5-second check poll. */
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
    function resolvePullRequestDetail(repository: string, number: number): PullRequestDetail | null {
        const key = pullRequestKey(repository, number);
        const fromQuery = queryClient.getQueryData<PullRequestDetailQueryData>(
            queryKeys.pullRequest.detail(key),
        )?.detail;
        return fromQuery ?? state.state.pullRequests[key]?.detail ?? null;
    }

    function resolveReviewThreadItems(key: string): Array<ReviewThread> {
        const fromQuery = queryClient.getQueryData<ReviewThreadsQueryData>(queryKeys.pullRequest.threads(key))?.items;
        if (fromQuery) {
            return fromQuery;
        }
        return state.state.reviewThreads[key]?.items ?? [];
    }

    function resolveConversationItems(key: string): Array<PullRequestTimelineItem> {
        const fromQuery = queryClient.getQueryData<ConversationQueryData>(
            queryKeys.pullRequest.conversation(key),
        )?.items;
        if (fromQuery) {
            return fromQuery;
        }
        return state.state.conversationComments[key]?.items ?? [];
    }

    function pullRequestFilesAreLoaded(key: string): boolean {
        const fromQuery = queryClient.getQueryData<PullRequestFilesQueryData>(queryKeys.pullRequest.files(key));
        if (fromQuery?.items.length) {
            return true;
        }
        const files = state.state.pullRequests[key]?.files;
        return files?.status === "ready" || Boolean(files?.items.length);
    }

    function getPullRequestPage(repository: string, number: number): PullRequestPage {
        const key = pullRequestKey(repository, number);
        const view = state.state.pullRequests[key] ?? initialPullRequestView;
        const inboxData = readInboxQueryData();
        const summary = inboxData.pullRequests.find((pullRequest) => pullRequest.key === key) ?? null;
        const detail = resolvePullRequestDetail(repository, number);
        const filesData = queryClient.getQueryData<PullRequestFilesQueryData>(queryKeys.pullRequest.files(key));

        return {
            ...view,
            repository,
            number,
            summary,
            detail,
            lastLoadedAt:
                queryClient.getQueryData<PullRequestDetailQueryData>(queryKeys.pullRequest.detail(key))?.lastLoadedAt ??
                view.lastLoadedAt,
            files: filesData
                ? {
                      status: "ready",
                      refreshing: false,
                      items: filesData.items,
                      lastLoadedAt: filesData.lastLoadedAt,
                      error: null,
                  }
                : view.files,
        };
    }

    /** Paths only — opening Review Changes must not download every patch. */
    async function refreshPullRequestFiles(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestFileListLoads.get(key) ?? 0) + 1;
        latestFileListLoads.set(key, attempt);

        const cached = state.state.pullRequests[key]?.files.items ?? [];
        setFiles(key, { refreshing: true, status: cached.length ? "ready" : "loading", error: null });

        try {
            await queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.files(key) });
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.files(key),
                queryFn: async () => {
                    const items = await github.listPullRequestFiles(requireToken(), repository, number);
                    return { items, lastLoadedAt: new Date().toISOString() };
                },
            });
            if (attempt !== latestFileListLoads.get(key)) return;

            void queryClient.removeQueries({ queryKey: ["pullRequest", key, "diff"] });

            setPullRequest(key, {
                files: {
                    status: "ready",
                    refreshing: false,
                    items: data.items,
                    lastLoadedAt: data.lastLoadedAt,
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
        const key = pullRequestKey(repository, number);
        const files = state.state.pullRequests[key]?.files;

        if (files?.refreshing || pullRequestFilesAreLoaded(key)) {
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
        // Empty both-sides payloads are not "warm" — that used to mask Contents API 404s on
        // fork PR head OIDs as "No textual changes".
        const cachedHasContent =
            cached != null && (cached.lines.length > 0 || Boolean(cached.beforeText) || Boolean(cached.afterText));
        if (
            !force &&
            cachedHasContent &&
            cached.stub === null &&
            state.state.pullRequests[key]?.diffs[path]?.status === "ready"
        ) {
            return;
        }

        setFileDiff(key, path, { refreshing: true, status: cached ? "ready" : "loading", error: null });

        try {
            const previousPath =
                state.state.pullRequests[key]?.files.items.find((file) => file.path === path)?.previousPath ??
                queryClient
                    .getQueryData<PullRequestFilesQueryData>(queryKeys.pullRequest.files(key))
                    ?.items.find((file) => file.path === path)?.previousPath ??
                null;
            if (force) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.diff(key, path) });
            }
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.diff(key, path),
                queryFn: async () => {
                    const diff = await github.getPullRequestFileDiff(requireToken(), repository, number, path, {
                        force,
                        previousPath,
                    });
                    return { diff };
                },
            });
            if (attempt !== latestFileDiffLoads.get(diffKey)) return;

            setFileDiff(key, path, { status: "ready", refreshing: false, diff: data.diff, error: null });
        } catch (error) {
            if (attempt !== latestFileDiffLoads.get(diffKey)) return;
            setFileDiff(key, path, {
                status: cached ? "ready" : "error",
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    /**
     * Files changed between two commits on the repository (not the full PR file list).
     * Used by the Files changed commit-range picker.
     */
    async function listComparedFiles(
        repository: string,
        baseOid: string,
        headOid: string,
    ): Promise<Array<PullRequestFile>> {
        return github.listComparedFiles(requireToken(), repository, baseOid, headOid);
    }

    /**
     * One file’s diff for an explicit commit range. Does not touch the full-PR diff cache.
     */
    async function getFileDiffBetween(
        repository: string,
        number: number,
        path: string,
        options: {
            baseOid: string;
            headOid: string;
            previousPath?: string | null;
            force?: boolean;
        },
    ): Promise<FileDiff> {
        return github.getPullRequestFileDiff(requireToken(), repository, number, path, {
            force: options.force,
            previousPath: options.previousPath,
            baseOid: options.baseOid,
            headOid: options.headOid,
        });
    }

    function getFileDiff(repository: string, number: number, path: string): FileDiffState {
        const key = pullRequestKey(repository, number);
        const cached = queryClient.getQueryData<FileDiffQueryData>(queryKeys.pullRequest.diff(key, path));
        if (cached?.diff) {
            return { status: "ready", refreshing: false, diff: cached.diff, error: null };
        }
        return state.state.pullRequests[key]?.diffs[path] ?? initialFileDiffState;
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

    /** Anything the reviewer would lose if we silently rewrote the draft onto a new head. */
    function draftHasPendingWork(draft: Pick<ReviewDraft, "body" | "comments" | "event">): boolean {
        return draft.comments.length > 0 || Boolean(draft.body.trim()) || draft.event !== "comment";
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
     * Empty drafts (nothing pending) silently rebind to the new tip — no false “head moved” banner.
     */
    async function mergeDraftWithGithubPendingReview(
        detail: PullRequestDetail,
        draft: ReviewDraft,
    ): Promise<ReviewDraft> {
        const login = viewerLogin();
        if (!login || state.state.auth.status !== "authenticated") {
            return draft;
        }

        try {
            const token = requireToken();
            const pending = await github.getViewerPendingReview(token, detail.repository, detail.number, login);
            if (!pending) {
                return draft.githubReviewId
                    ? { ...draft, githubReviewId: undefined, githubReviewNodeId: undefined }
                    : draft;
            }

            const remoteRows = await github.listPendingReviewComments(
                token,
                detail.repository,
                detail.number,
                pending.reviewId,
            );
            const remoteComments: Array<PendingLineComment> = remoteRows.map((row) => ({
                id: `gh-${row.id}`,
                path: row.path,
                line: row.line,
                side: row.side,
                body: row.body,
                githubCommentId: row.id,
            }));
            const localOnly = draft.comments.filter((comment) => !comment.githubCommentId);
            const mergedComments = [
                ...remoteComments,
                ...localOnly.filter(
                    (local) =>
                        !remoteComments.some(
                            (remote) =>
                                remote.path === local.path && remote.line === local.line && remote.side === local.side,
                        ),
                ),
            ];
            const headMoved = pending.commitId !== detail.headSha;
            const comments = mergedComments.length > 0 ? mergedComments : draft.comments;

            return {
                ...draft,
                githubReviewId: pending.reviewId,
                githubReviewNodeId: pending.reviewNodeId,
                body: draft.body.trim() ? draft.body : pending.body,
                headSha: headMoved && draftHasPendingWork({ ...draft, comments }) ? pending.commitId : detail.headSha,
                stale: headMoved && draftHasPendingWork({ ...draft, comments }),
                comments,
            };
        } catch {
            return draft;
        }
    }

    async function ensureGithubPendingReview(detail: PullRequestDetail, draft: ReviewDraft): Promise<ReviewDraft> {
        if (draft.githubReviewId && draft.githubReviewNodeId) {
            return draft;
        }

        if (draft.githubReviewId && !draft.githubReviewNodeId) {
            const login = viewerLogin();
            if (login) {
                const pending = await github.getViewerPendingReview(
                    requireToken(),
                    detail.repository,
                    detail.number,
                    login,
                );
                if (pending?.reviewId === draft.githubReviewId) {
                    return { ...draft, githubReviewNodeId: pending.reviewNodeId };
                }
            }
            return draft;
        }

        const { reviewId, reviewNodeId } = await github.createPendingReview(
            requireToken(),
            detail.repository,
            detail.number,
            detail.headSha,
            draft.body,
        );
        return { ...draft, githubReviewId: reviewId, githubReviewNodeId: reviewNodeId };
    }

    async function syncDraftWithHead(detail: PullRequestDetail): Promise<void> {
        const key = pullRequestKey(detail.repository, detail.number);
        const login = viewerLogin();
        const stored = login
            ? await readJson<ReviewDraft>(draftStorageKey(login, detail.repository, detail.number))
            : null;
        const base = stored ?? emptyDraft(detail.repository, detail.number, detail.headSha);
        const boundHead = Boolean(stored?.headSha);
        const headMoved = boundHead && stored!.headSha !== detail.headSha;
        const hasWork = draftHasPendingWork(base);

        if (headMoved && !hasWork) {
            const draft = await mergeDraftWithGithubPendingReview(
                detail,
                emptyDraft(detail.repository, detail.number, detail.headSha),
            );
            await persistDraft(draft);
            return;
        }

        let draft: ReviewDraft = {
            ...base,
            repository: detail.repository,
            number: detail.number,
            stale: headMoved && hasWork,
            headSha: headMoved && hasWork ? stored!.headSha : boundHead ? stored!.headSha : detail.headSha,
        };

        draft = await mergeDraftWithGithubPendingReview(detail, draft);

        state.setState((prev) => ({ ...prev, reviewDrafts: { ...prev.reviewDrafts, [key]: draft } }));

        if ((stored && !boundHead && draft.comments.length > 0) || draft.githubReviewId) {
            await persistDraft(draft);
        }
    }

    function getReviewDraft(repository: string, number: number): ReviewDraft {
        const key = pullRequestKey(repository, number);
        const live = state.state.reviewDrafts[key];
        if (live) {
            return live;
        }

        const headSha = resolvePullRequestDetail(repository, number)?.headSha ?? "";
        return emptyDraft(repository, number, headSha);
    }

    async function ensureDraft(repository: string, number: number): Promise<ReviewDraft> {
        const key = pullRequestKey(repository, number);
        const existing = state.state.reviewDrafts[key];
        if (existing) {
            return existing;
        }

        const detail = resolvePullRequestDetail(repository, number);
        if (detail) {
            await syncDraftWithHead(detail);
            return state.state.reviewDrafts[key] ?? emptyDraft(repository, number, detail.headSha);
        }

        const draft = emptyDraft(repository, number, "");
        state.setState((prev) => ({ ...prev, reviewDrafts: { ...prev.reviewDrafts, [key]: draft } }));
        return draft;
    }

    async function setReviewEvent(repository: string, number: number, event: ReviewEvent): Promise<void> {
        const key = pullRequestKey(repository, number);
        const hadDraft = Boolean(state.state.reviewDrafts[key]);
        await persistDraft({ ...getReviewDraft(repository, number), event });
        if (hadDraft) {
            return;
        }

        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            return;
        }

        await syncDraftWithHead(detail);
        const merged = state.state.reviewDrafts[key];
        if (merged && merged.event !== event) {
            await persistDraft({ ...merged, event });
        }
    }

    async function setReviewBody(repository: string, number: number, body: string): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestDraftBodyWrites.get(key) ?? 0) + 1;
        latestDraftBodyWrites.set(key, attempt);

        const draft = state.state.reviewDrafts[key] ?? getReviewDraft(repository, number);
        const next = { ...draft, body };

        // Apply the body before any await so a controlled composer does not revert mid-keystroke
        // (which parks the caret at the end).
        state.setState((prev) => ({
            ...prev,
            reviewDrafts: { ...prev.reviewDrafts, [key]: next },
        }));

        if (attempt !== latestDraftBodyWrites.get(key)) {
            return;
        }

        await persistDraft(next);
    }

    async function addPendingComment(
        repository: string,
        number: number,
        input: { path: string; line: number; side: DiffSide; body: string },
    ): Promise<PendingLineComment> {
        const draft = await ensureDraft(repository, number);
        const detail = resolvePullRequestDetail(repository, number);
        const headSha = detail?.headSha ?? draft.headSha;
        const comment: PendingLineComment = {
            id: crypto.randomUUID(),
            path: input.path,
            line: input.line,
            side: input.side,
            body: input.body,
        };

        let nextDraft: ReviewDraft = {
            ...draft,
            headSha: draft.comments.length === 0 && !draft.stale ? headSha : draft.headSha,
            comments: [...draft.comments, comment],
        };

        if (detail) {
            nextDraft = await ensureGithubPendingReview(detail, nextDraft);
            if (nextDraft.githubReviewNodeId) {
                const { commentId } = await github.addPullRequestReviewThread(requireToken(), {
                    pullRequestNodeId: detail.pullRequestNodeId,
                    pullRequestReviewNodeId: nextDraft.githubReviewNodeId,
                    path: input.path,
                    line: input.line,
                    side: input.side,
                    body: input.body,
                });
                comment.githubCommentId = commentId;
                nextDraft = {
                    ...nextDraft,
                    comments: nextDraft.comments.map((entry) =>
                        entry.id === comment.id ? { ...entry, githubCommentId: commentId } : entry,
                    ),
                };
            }
        }

        await persistDraft(nextDraft);

        return comment;
    }

    async function updatePendingComment(
        repository: string,
        number: number,
        commentId: string,
        body: string,
    ): Promise<void> {
        const draft = await ensureDraft(repository, number);
        const existing = draft.comments.find((comment) => comment.id === commentId);
        const nextDraft: ReviewDraft = {
            ...draft,
            comments: draft.comments.map((comment) => (comment.id === commentId ? { ...comment, body } : comment)),
        };

        if (existing?.githubCommentId) {
            await github.updateReviewComment(requireToken(), repository, existing.githubCommentId, body);
        }

        await persistDraft(nextDraft);
    }

    async function removePendingComment(repository: string, number: number, commentId: string): Promise<void> {
        const draft = await ensureDraft(repository, number);
        const existing = draft.comments.find((comment) => comment.id === commentId);
        const comments = draft.comments.filter((comment) => comment.id !== commentId);

        if (existing?.githubCommentId) {
            await github.deleteReviewComment(requireToken(), repository, existing.githubCommentId);
        }

        await persistDraft({ ...draft, comments });
    }

    /** Drop a stale or unwanted draft so the reviewer can start clean against the current head. */
    async function discardReviewDraft(repository: string, number: number): Promise<void> {
        const headSha = resolvePullRequestDetail(repository, number)?.headSha ?? "";
        await persistDraft(emptyDraft(repository, number, headSha));
    }

    async function submitReview(repository: string, number: number): Promise<void> {
        const draft = await ensureDraft(repository, number);
        const detail = resolvePullRequestDetail(repository, number);

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
            githubReviewId: draft.githubReviewId,
            comments: draft.githubReviewId
                ? []
                : draft.comments.map(({ path, line, side, body }) => ({ path, line, side, body })),
        });

        await persistDraft(emptyDraft(repository, number, detail.headSha));
        void refreshAfterMutation(repository, number, { reloadReviewSurfaces: true, reloadStack: true });
        invalidateInbox();
    }

    /** Publish one line comment immediately as a Comment review (does not touch the staged draft). */
    async function addSingleLineComment(
        repository: string,
        number: number,
        input: { path: string; line: number; side: DiffSide; body: string },
    ): Promise<void> {
        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            throw new EasyReviewError("unknown", "Load the pull request before commenting.");
        }

        const body = input.body.trim();
        if (!body) {
            throw new EasyReviewError("unknown", "Comment body is required.");
        }

        await github.addPullRequestReviewThread(requireToken(), {
            pullRequestNodeId: detail.pullRequestNodeId,
            body,
            path: input.path,
            line: input.line,
            side: input.side,
        });

        await refreshAfterMutation(repository, number, { reloadReviewSurfaces: true });
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
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.threads(key),
                queryFn: async () => {
                    const items = await github.listReviewThreads(requireToken(), repository, number);
                    return { items };
                },
            });
            if (attempt !== latestReviewThreadLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                reviewThreads: { ...prev.reviewThreads, [key]: { status: "ready", items: data.items, error: null } },
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
        const key = pullRequestKey(repository, number);
        const cached = queryClient.getQueryData<ReviewThreadsQueryData>(queryKeys.pullRequest.threads(key));
        if (cached) {
            return { status: "ready", items: cached.items, error: null };
        }
        return state.state.reviewThreads[key] ?? initialThreadsState;
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
            const nextItems = resolveReviewThreadItems(key).map((thread) =>
                thread.id === threadId ? { ...thread, comments: [...thread.comments, reply] } : thread,
            );
            queryClient.setQueryData<ReviewThreadsQueryData>(queryKeys.pullRequest.threads(key), { items: nextItems });
            return {
                ...prev,
                reviewThreads: {
                    ...prev.reviewThreads,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
            };
        });
        return reply;
    }

    async function setReviewThreadResolved(
        repository: string,
        number: number,
        threadId: string,
        resolved: boolean,
    ): Promise<void> {
        await github.setReviewThreadResolved(requireToken(), threadId, resolved);
        const key = pullRequestKey(repository, number);
        state.setState((prev) => {
            const nextItems = resolveReviewThreadItems(key).map((thread) =>
                thread.id === threadId ? { ...thread, isResolved: resolved } : thread,
            );
            queryClient.setQueryData<ReviewThreadsQueryData>(queryKeys.pullRequest.threads(key), { items: nextItems });
            return {
                ...prev,
                reviewThreads: {
                    ...prev.reviewThreads,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
            };
        });
    }

    async function loadConversationComments(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestConversationCommentLoads.get(key) ?? 0) + 1;
        latestConversationCommentLoads.set(key, attempt);

        state.setState((prev) => ({
            ...prev,
            conversationComments: {
                ...prev.conversationComments,
                [key]: {
                    status: "loading",
                    items: prev.conversationComments[key]?.items ?? [],
                    error: null,
                },
            },
        }));

        try {
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.conversation(key),
                queryFn: async () => {
                    const items = await github.listPullRequestTimeline(requireToken(), repository, number);
                    return { items };
                },
            });
            if (attempt !== latestConversationCommentLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                conversationComments: {
                    ...prev.conversationComments,
                    [key]: { status: "ready", items: data.items, error: null },
                },
            }));
        } catch (error) {
            if (attempt !== latestConversationCommentLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                conversationComments: {
                    ...prev.conversationComments,
                    [key]: {
                        status: "error",
                        items: prev.conversationComments[key]?.items ?? [],
                        error: toSessionError(error),
                    },
                },
            }));
        }
    }

    function getConversationComments(repository: string, number: number): ConversationCommentsState {
        const key = pullRequestKey(repository, number);
        const cached = queryClient.getQueryData<ConversationQueryData>(queryKeys.pullRequest.conversation(key));
        if (cached) {
            return { status: "ready", items: cached.items, error: null };
        }
        return state.state.conversationComments[key] ?? initialConversationState;
    }

    async function loadPullRequestCommits(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const current = state.state.pullRequestCommits[key];
        if (current?.status === "ready" || current?.status === "loading") {
            return;
        }

        const attempt = (latestPullRequestCommitLoads.get(key) ?? 0) + 1;
        latestPullRequestCommitLoads.set(key, attempt);

        state.setState((prev) => ({
            ...prev,
            pullRequestCommits: {
                ...prev.pullRequestCommits,
                [key]: {
                    status: "loading",
                    items: prev.pullRequestCommits[key]?.items ?? [],
                    error: null,
                },
            },
        }));

        try {
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.commits(key),
                queryFn: async () => {
                    const items = await github.listPullRequestCommits(requireToken(), repository, number);
                    return { items };
                },
            });
            if (attempt !== latestPullRequestCommitLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                pullRequestCommits: {
                    ...prev.pullRequestCommits,
                    [key]: { status: "ready", items: data.items, error: null },
                },
            }));
        } catch (error) {
            if (attempt !== latestPullRequestCommitLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                pullRequestCommits: {
                    ...prev.pullRequestCommits,
                    [key]: {
                        status: "error",
                        items: prev.pullRequestCommits[key]?.items ?? [],
                        error: toSessionError(error),
                    },
                },
            }));
        }
    }

    function getPullRequestCommits(repository: string, number: number): PullRequestCommitsState {
        const key = pullRequestKey(repository, number);
        const cached = queryClient.getQueryData<PullRequestCommitsQueryData>(queryKeys.pullRequest.commits(key));
        if (cached) {
            return { status: "ready", items: cached.items, error: null };
        }
        return state.state.pullRequestCommits[key] ?? initialCommitsState;
    }

    function relatedContextFor(
        repository: string,
        number: number,
    ): { headRefName: string; baseRefName: string; createdAt: string } | null {
        const page = getPullRequestPage(repository, number);
        const source = page.detail ?? page.summary;
        if (!source) {
            return null;
        }

        return {
            headRefName: source.headRefName,
            baseRefName: source.baseRefName,
            createdAt: source.createdAt,
        };
    }

    async function repositoriesForRelatedSearch(repository: string): Promise<Array<string>> {
        if (state.state.repos.status !== "ready" && state.state.repos.available.length === 0) {
            await refreshRepositories();
        }

        return state.state.repos.available
            .map((entry) => entry.nameWithOwner)
            .filter((nameWithOwner) => nameWithOwner !== repository);
    }

    async function loadRelatedPullRequests(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const context = relatedContextFor(repository, number);
        if (!context) {
            return;
        }

        const current = state.state.relatedPullRequests[key];
        if (
            current &&
            (current.status === "loading" || current.status === "ready") &&
            current.headRefName === context.headRefName &&
            current.baseRefName === context.baseRefName
        ) {
            return;
        }

        const attempt = (latestRelatedPullRequestLoads.get(key) ?? 0) + 1;
        latestRelatedPullRequestLoads.set(key, attempt);

        state.setState((prev) => ({
            ...prev,
            relatedPullRequests: {
                ...prev.relatedPullRequests,
                [key]: {
                    status: "loading",
                    items: prev.relatedPullRequests[key]?.items ?? [],
                    headRefName: context.headRefName,
                    baseRefName: context.baseRefName,
                    error: null,
                },
            },
        }));

        try {
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.pullRequest.related(key),
                queryFn: async () => {
                    const repositories = await repositoriesForRelatedSearch(repository);
                    const fetched =
                        repositories.length === 0
                            ? []
                            : await github.listRelatedPullRequests(requireToken(), {
                                  repositories,
                                  headRefName: context.headRefName,
                                  baseRefName: context.baseRefName,
                              });
                    const items = selectRelatedPullRequests({
                        pullRequests: fetched,
                        headRefName: context.headRefName,
                        baseRefName: context.baseRefName,
                        excludeRepository: repository,
                        focalCreatedAt: context.createdAt,
                    });
                    return {
                        items,
                        headRefName: context.headRefName,
                        baseRefName: context.baseRefName,
                    };
                },
            });

            if (attempt !== latestRelatedPullRequestLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                relatedPullRequests: {
                    ...prev.relatedPullRequests,
                    [key]: {
                        status: "ready",
                        items: data.items,
                        headRefName: data.headRefName,
                        baseRefName: data.baseRefName,
                        error: null,
                    },
                },
            }));
        } catch (error) {
            if (attempt !== latestRelatedPullRequestLoads.get(key)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                relatedPullRequests: {
                    ...prev.relatedPullRequests,
                    [key]: {
                        status: "error",
                        items: prev.relatedPullRequests[key]?.items ?? [],
                        headRefName: context.headRefName,
                        baseRefName: context.baseRefName,
                        error: toSessionError(error),
                    },
                },
            }));
        }
    }

    function getRelatedPullRequests(repository: string, number: number): RelatedPullRequestsState {
        const key = pullRequestKey(repository, number);
        const cached = queryClient.getQueryData<RelatedPullRequestsQueryData>(queryKeys.pullRequest.related(key));
        if (cached) {
            return {
                status: "ready",
                items: cached.items,
                headRefName: cached.headRefName,
                baseRefName: cached.baseRefName,
                error: null,
            };
        }
        return state.state.relatedPullRequests[key] ?? initialRelatedState;
    }

    function getPullRequestStack(repository: string, number: number): PullRequestStackState {
        if (!areStacksEnabled()) {
            return { status: "idle", stack: null, error: null };
        }

        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            return { status: "loading", stack: null, error: null };
        }

        return {
            status: "ready",
            stack: resolveGithubPullRequestStack({
                repository,
                number,
                githubStack: detail.githubStack,
                pullRequests: detail.githubStackPullRequests,
                hideClosed: getStackPreferences().hideClosed,
            }),
            error: null,
        };
    }

    async function addPullRequestComment(
        repository: string,
        number: number,
        body: string,
    ): Promise<PullRequestComment> {
        const trimmed = body.trim();
        if (!trimmed) {
            throw new EasyReviewError("unknown", "Write a comment before posting.");
        }

        const comment = await github.addPullRequestComment(requireToken(), repository, number, trimmed);
        const key = pullRequestKey(repository, number);
        const timelineComment: PullRequestTimelineItem = { kind: "comment", ...comment };
        state.setState((prev) => {
            const nextItems = [...resolveConversationItems(key), timelineComment];
            queryClient.setQueryData<ConversationQueryData>(queryKeys.pullRequest.conversation(key), {
                items: nextItems,
            });
            const detail = resolvePullRequestDetail(repository, number);
            const nextDetail = detail != null ? { ...detail, commentCount: detail.commentCount + 1 } : null;
            if (nextDetail) {
                setPullRequestDetailQueryData(queryClient, key, nextDetail);
            }
            const view = prev.pullRequests[key];
            return {
                ...prev,
                conversationComments: {
                    ...prev.conversationComments,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
                pullRequests: nextDetail
                    ? {
                          ...prev.pullRequests,
                          [key]: {
                              ...(view ?? initialPullRequestView),
                              detail: nextDetail,
                          },
                      }
                    : prev.pullRequests,
            };
        });
        return comment;
    }

    /**
     * After a lifecycle mutation, re-fetch the PR and patch the Inbox row so section
     * classification and the overview stay aligned without a full inbox refresh.
     * Shares the pull-request load generation counter so a slower tab-focus refresh
     * cannot paint over the mutation result. Soft-fails the fetch so a successful
     * GitHub write is not reported as an action failure.
     */
    type PullRequestMutationRefreshOptions = {
        /** Reload conversation/threads when those surfaces were already fetched. */
        reloadSecondary?: boolean;
        /** Always reload review threads and conversation (after submitting review comments). */
        reloadReviewSurfaces?: boolean;
        /** Refresh other GitHub stack layers after merge / close. */
        reloadStack?: boolean;
    };

    async function refreshAfterMutation(
        repository: string,
        number: number,
        options?: PullRequestMutationRefreshOptions,
    ): Promise<void> {
        const key = pullRequestKey(repository, number);
        const attempt = (latestPullRequestLoads.get(key) ?? 0) + 1;
        latestPullRequestLoads.set(key, attempt);

        try {
            const detail = await github.getPullRequest(requireToken(), repository, number);
            if (attempt !== latestPullRequestLoads.get(key)) {
                return;
            }

            const summary = toInboxSummary(detail);

            setPullRequest(key, {
                status: "ready",
                refreshing: false,
                detail,
                lastLoadedAt: new Date().toISOString(),
                error: null,
            });
            setPullRequestDetailQueryData(queryClient, key, detail);

            const inboxData = readInboxQueryData();
            const login = state.state.auth.viewer?.login ?? "";
            if (login) {
                const nextInbox = patchInboxPullRequest(inboxData, summary, {
                    viewerLogin: login,
                    sections: state.state.inbox.sectionLayout,
                });
                syncInboxQueryData(nextInbox);
                if (nextInbox.lastLoadedAt) {
                    await store.set(
                        INBOX_CACHE_KEY,
                        JSON.stringify({
                            pullRequests: nextInbox.pullRequests,
                            sectionPullRequests: nextInbox.sectionPullRequests,
                            sectionCounts: nextInbox.sectionCounts,
                            lastLoadedAt: nextInbox.lastLoadedAt,
                        } satisfies InboxCache),
                    );
                }
            }

            await syncDraftWithHead(detail);
            if (login) {
                invalidatePullRequestSecondaryAfterMutation(queryClient, login, repository, number);
            }
            if (options?.reloadStack) {
                for (const layer of detail.githubStackPullRequests) {
                    if (layer.number === number) {
                        continue;
                    }
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.pullRequest.detail(pullRequestKey(repository, layer.number)),
                        refetchType: "active",
                    });
                }
            }
            if (options?.reloadReviewSurfaces) {
                await Promise.all([
                    loadReviewThreads(repository, number),
                    loadConversationComments(repository, number),
                ]);
            } else if (options?.reloadSecondary) {
                await refreshSecondaryPullRequestViews(repository, number);
            }
        } catch (error) {
            if (attempt !== latestPullRequestLoads.get(key)) {
                return;
            }

            setPullRequest(key, {
                refreshing: false,
                error: toSessionError(error),
            });
        }
    }

    /** Soft-refresh conversation/threads when a PR overview refresh already loaded them. */
    async function refreshSecondaryPullRequestViews(repository: string, number: number): Promise<void> {
        const key = pullRequestKey(repository, number);
        const conversation = state.state.conversationComments[key];
        const threads = state.state.reviewThreads[key];

        await Promise.all([
            conversation && conversation.status !== "idle"
                ? loadConversationComments(repository, number)
                : Promise.resolve(),
            threads && threads.status !== "idle" ? loadReviewThreads(repository, number) : Promise.resolve(),
        ]);
    }

    async function setPullRequestDraft(repository: string, number: number, isDraft: boolean): Promise<void> {
        await github.setPullRequestDraft(requireToken(), repository, number, isDraft);
        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function setPullRequestFileViewed(
        repository: string,
        number: number,
        path: string,
        viewed: boolean,
    ): Promise<void> {
        await github.setPullRequestFileViewed(requireToken(), repository, number, path, viewed);
    }

    async function loadRepositoryMetadata(repository: string): Promise<void> {
        const attempt = (latestRepositoryMetadataLoads.get(repository) ?? 0) + 1;
        latestRepositoryMetadataLoads.set(repository, attempt);

        state.setState((prev) => ({
            ...prev,
            repositoryMetadata: {
                ...prev.repositoryMetadata,
                [repository]: {
                    status: "loading",
                    users: prev.repositoryMetadata[repository]?.users ?? [],
                    labels: prev.repositoryMetadata[repository]?.labels ?? [],
                    error: null,
                },
            },
        }));

        try {
            const data = await queryClient.fetchQuery({
                queryKey: queryKeys.repository.metadata(repository),
                queryFn: async () => {
                    const [users, labels] = await Promise.all([
                        github.listRepositoryAssignees(requireToken(), repository),
                        github.listRepositoryLabels(requireToken(), repository),
                    ]);
                    return { users, labels };
                },
            });

            if (attempt !== latestRepositoryMetadataLoads.get(repository)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                repositoryMetadata: {
                    ...prev.repositoryMetadata,
                    [repository]: { status: "ready", users: data.users, labels: data.labels, error: null },
                },
            }));
        } catch (error) {
            if (attempt !== latestRepositoryMetadataLoads.get(repository)) {
                return;
            }

            state.setState((prev) => ({
                ...prev,
                repositoryMetadata: {
                    ...prev.repositoryMetadata,
                    [repository]: {
                        status: "error",
                        users: prev.repositoryMetadata[repository]?.users ?? [],
                        labels: prev.repositoryMetadata[repository]?.labels ?? [],
                        error: toSessionError(error),
                    },
                },
            }));
        }
    }

    function getRepositoryMetadata(repository: string): RepositoryMetadataState {
        const cached = queryClient.getQueryData<RepositoryMetadataQueryData>(queryKeys.repository.metadata(repository));
        if (cached) {
            return { status: "ready", users: cached.users, labels: cached.labels, error: null };
        }
        return state.state.repositoryMetadata[repository] ?? initialRepositoryMetadata;
    }

    async function setPullRequestLabels(
        repository: string,
        number: number,
        labels: ReadonlyArray<string>,
    ): Promise<void> {
        await github.setPullRequestLabels(requireToken(), repository, number, labels);
        await refreshAfterMutation(repository, number);
    }

    async function setPullRequestAssignees(
        repository: string,
        number: number,
        assignees: ReadonlyArray<string>,
    ): Promise<void> {
        await github.setPullRequestAssignees(requireToken(), repository, number, assignees);
        await refreshAfterMutation(repository, number);
    }

    async function setReviewRequests(
        repository: string,
        number: number,
        reviewers: ReadonlyArray<string>,
    ): Promise<void> {
        const detail = resolvePullRequestDetail(repository, number);
        const current = new Set(detail?.reviewRequests ?? []);
        const wanted = new Set(reviewers);
        const toAdd = [...wanted].filter((login) => !current.has(login));
        const toRemove = [...current].filter((login) => !wanted.has(login));

        // Add before remove so a failed add cannot leave the wanted set already stripped.
        if (toAdd.length > 0) {
            await github.requestReviewers(requireToken(), repository, number, toAdd);
        }
        if (toRemove.length > 0) {
            await github.removeReviewers(requireToken(), repository, number, toRemove);
        }

        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function reRequestReview(
        repository: string,
        number: number,
        reviewers: ReadonlyArray<string>,
    ): Promise<void> {
        if (reviewers.length === 0) {
            return;
        }

        await github.reRequestReview(requireToken(), repository, number, reviewers);
        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function dismissReview(repository: string, number: number, reviewId: number, message: string): Promise<void> {
        const trimmed = message.trim();
        if (!trimmed) {
            throw new EasyReviewError("unknown", "A comment is required to dismiss a review.");
        }

        await github.dismissReview(requireToken(), repository, number, reviewId, trimmed);
        await refreshAfterMutation(repository, number, { reloadSecondary: true, reloadStack: true });
    }

    async function updatePullRequestBody(repository: string, number: number, body: string): Promise<void> {
        await github.updatePullRequestBody(requireToken(), repository, number, body);
        await refreshAfterMutation(repository, number);
    }

    async function applySuggestions(
        repository: string,
        number: number,
        input: {
            message: string;
            changes: ReadonlyArray<SuggestionChange>;
        },
    ): Promise<void> {
        const detail = getPullRequestPage(repository, number).detail;
        if (!detail) {
            throw new EasyReviewError("unknown", "Pull request is not loaded.");
        }
        if (detail.state !== "open") {
            throw new EasyReviewError("unknown", "Suggestions can only be applied on open pull requests.");
        }
        const message = input.message.trim();
        if (!message) {
            throw new EasyReviewError("unknown", "Commit message cannot be empty.");
        }
        if (input.changes.length === 0) {
            throw new EasyReviewError("unknown", "No suggestions to apply.");
        }
        await github.applySuggestions(requireToken(), {
            repository,
            number,
            headRefName: detail.headRefName,
            headSha: detail.headSha,
            message,
            changes: input.changes,
        });
        await refreshAfterMutation(repository, number, { reloadStack: true });
        // Head moved — drop cached diffs so the viewer reloads the committed content.
        await refreshPullRequestFiles(repository, number);
        const commitsKey = pullRequestKey(repository, number);
        latestPullRequestCommitLoads.set(commitsKey, (latestPullRequestCommitLoads.get(commitsKey) ?? 0) + 1);
        state.setState((prev) => ({
            ...prev,
            pullRequestCommits: { ...prev.pullRequestCommits, [commitsKey]: initialCommitsState },
        }));
    }

    async function updatePullRequest(
        repository: string,
        number: number,
        input: { title?: string; base?: string },
    ): Promise<void> {
        const title = input.title?.trim();
        const base = input.base?.trim();
        if (title !== undefined && title.length === 0) {
            throw new EasyReviewError("unknown", "Title cannot be empty.");
        }
        await github.updatePullRequest(requireToken(), repository, number, {
            ...(title !== undefined ? { title } : {}),
            ...(base !== undefined ? { base } : {}),
        });
        await refreshAfterMutation(repository, number);
    }

    async function listRepositoryBranches(repository: string): Promise<Array<string>> {
        return github.listRepositoryBranches(requireToken(), repository);
    }

    function patchReactionGroups(
        groups: Array<ReactionGroup>,
        content: ReactionContent,
        reacted: boolean,
    ): Array<ReactionGroup> {
        const existing = groups.find((group) => group.content === content);
        if (reacted) {
            if (existing) {
                return groups.map((group) =>
                    group.content === content
                        ? { ...group, count: group.count + (group.viewerHasReacted ? 0 : 1), viewerHasReacted: true }
                        : group,
                );
            }
            return [...groups, { content, count: 1, viewerHasReacted: true }];
        }
        if (!existing) {
            return groups;
        }
        if (existing.count <= 1) {
            return groups.filter((group) => group.content !== content);
        }
        return groups.map((group) =>
            group.content === content ? { ...group, count: group.count - 1, viewerHasReacted: false } : group,
        );
    }

    async function toggleIssueReaction(repository: string, number: number, content: ReactionContent): Promise<void> {
        const token = requireToken();
        const viewerLogin = state.state.auth.viewer?.login;
        if (!viewerLogin) {
            throw unauthorized();
        }

        const key = pullRequestKey(repository, number);
        const detail = resolvePullRequestDetail(repository, number);
        const already = detail?.reactionGroups.some((group) => group.content === content && group.viewerHasReacted);

        if (already) {
            const reactionId = await github.findIssueReactionId(token, repository, number, content, viewerLogin);
            if (reactionId != null) {
                await github.deleteIssueReaction(token, repository, number, reactionId);
            }
        } else {
            await github.createIssueReaction(token, repository, number, content);
        }

        if (detail) {
            const nextDetail = {
                ...detail,
                reactionGroups: patchReactionGroups(detail.reactionGroups, content, !already),
            };
            setPullRequestDetailQueryData(queryClient, key, nextDetail);
            setPullRequest(key, {
                status: "ready",
                refreshing: false,
                detail: nextDetail,
                lastLoadedAt: new Date().toISOString(),
                error: null,
            });
        }
    }

    async function toggleIssueCommentReaction(
        repository: string,
        number: number,
        commentId: number,
        content: ReactionContent,
    ): Promise<void> {
        const token = requireToken();
        const viewerLogin = state.state.auth.viewer?.login;
        if (!viewerLogin) {
            throw unauthorized();
        }

        const key = pullRequestKey(repository, number);
        const conversationItems = resolveConversationItems(key);
        const item = conversationItems.find((entry) => entry.kind === "comment" && entry.databaseId === commentId);
        const already =
            item?.kind === "comment" &&
            item.reactionGroups.some((group) => group.content === content && group.viewerHasReacted);

        if (already) {
            const reactionId = await github.findIssueCommentReactionId(
                token,
                repository,
                commentId,
                content,
                viewerLogin,
            );
            if (reactionId != null) {
                await github.deleteIssueCommentReaction(token, repository, commentId, reactionId);
            }
        } else {
            await github.createIssueCommentReaction(token, repository, commentId, content);
        }

        state.setState((prev) => {
            const nextItems = conversationItems.map((entry) =>
                entry.kind === "comment" && entry.databaseId === commentId
                    ? {
                          ...entry,
                          reactionGroups: patchReactionGroups(entry.reactionGroups, content, !already),
                      }
                    : entry,
            );
            queryClient.setQueryData<ConversationQueryData>(queryKeys.pullRequest.conversation(key), {
                items: nextItems,
            });
            return {
                ...prev,
                conversationComments: {
                    ...prev.conversationComments,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
            };
        });
    }

    async function toggleReviewCommentReaction(
        repository: string,
        number: number,
        commentId: number,
        content: ReactionContent,
    ): Promise<void> {
        const token = requireToken();
        const viewerLogin = state.state.auth.viewer?.login;
        if (!viewerLogin) {
            throw unauthorized();
        }

        const key = pullRequestKey(repository, number);
        const threadItems = resolveReviewThreadItems(key);
        let already = false;

        for (const thread of threadItems) {
            const comment = thread.comments.find((entry) => entry.databaseId === commentId);
            if (comment) {
                already = comment.reactionGroups.some((group) => group.content === content && group.viewerHasReacted);
                break;
            }
        }

        if (already) {
            const reactionId = await github.findReviewCommentReactionId(
                token,
                repository,
                commentId,
                content,
                viewerLogin,
            );
            if (reactionId != null) {
                await github.deleteReviewCommentReaction(token, repository, commentId, reactionId);
            }
        } else {
            await github.createReviewCommentReaction(token, repository, commentId, content);
        }

        state.setState((prev) => {
            const nextItems = threadItems.map((thread) => ({
                ...thread,
                comments: thread.comments.map((comment) =>
                    comment.databaseId === commentId
                        ? {
                              ...comment,
                              reactionGroups: patchReactionGroups(comment.reactionGroups, content, !already),
                          }
                        : comment,
                ),
            }));
            queryClient.setQueryData<ReviewThreadsQueryData>(queryKeys.pullRequest.threads(key), { items: nextItems });
            return {
                ...prev,
                reviewThreads: {
                    ...prev.reviewThreads,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
            };
        });
    }

    async function mergePullRequest(
        repository: string,
        number: number,
        method: MergeMethod,
        options?: MergePullRequestOptions,
    ): Promise<void> {
        const token = requireToken();
        const detail = resolvePullRequestDetail(repository, number);
        if (detail?.githubStack) {
            await github.mergeStackedPullRequest(token, repository, number, method, options);
        } else {
            await github.mergePullRequest(token, repository, number, method, options);
        }

        if (options?.deleteHeadBranch && detail?.headRefName) {
            try {
                await github.deleteHeadBranch(token, repository, detail.headRefName);
            } catch {
                // Branch may already be deleted or protected.
            }
        }

        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function mergePullRequestStack(
        repository: string,
        number: number,
        method: MergeMethod,
        options?: StackMergePullRequestOptions,
    ): Promise<void> {
        if (!resolvePullRequestDetail(repository, number)) {
            await loadPullRequest(repository, number);
        }

        const stackState = getPullRequestStack(repository, number);
        if (stackState.status !== "ready" || !stackState.stack) {
            throw new EasyReviewError("unknown", "This pull request is not part of a GitHub stack.");
        }

        const evaluation = evaluateStackMerge(stackState.stack, {
            bypassRules: options?.bypassRules,
            upToNumber: number,
        });

        if (!evaluation.canMerge) {
            throw new EasyReviewError("unknown", evaluation.blockMessage ?? "This stack cannot be merged.");
        }

        const token = requireToken();
        await github.mergeStackedPullRequest(token, repository, number, method);

        if (options?.deleteHeadBranch) {
            for (const pullRequest of evaluation.mergeOrder) {
                if (!pullRequest.headRefName) {
                    continue;
                }
                try {
                    await github.deleteHeadBranch(token, repository, pullRequest.headRefName);
                } catch {
                    // Branch may already be deleted or protected.
                }
            }
        }

        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function reopenPullRequest(repository: string, number: number): Promise<void> {
        await github.reopenPullRequest(requireToken(), repository, number);
        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function updatePullRequestBranch(repository: string, number: number): Promise<void> {
        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            throw new EasyReviewError("unknown", "Load the pull request before updating the branch.");
        }

        await github.updatePullRequestBranch(requireToken(), detail.pullRequestNodeId, detail.headSha);
        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function enablePullRequestAutoMerge(repository: string, number: number, method: MergeMethod): Promise<void> {
        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            throw new EasyReviewError("unknown", "Load the pull request before enabling auto-merge.");
        }

        await github.enablePullRequestAutoMerge(requireToken(), detail.pullRequestNodeId, method);
        await refreshAfterMutation(repository, number);
    }

    async function disablePullRequestAutoMerge(repository: string, number: number): Promise<void> {
        const detail = resolvePullRequestDetail(repository, number);
        if (!detail) {
            throw new EasyReviewError("unknown", "Load the pull request before disabling auto-merge.");
        }

        await github.disablePullRequestAutoMerge(requireToken(), detail.pullRequestNodeId);
        await refreshAfterMutation(repository, number);
    }

    async function updateIssueComment(
        repository: string,
        number: number,
        commentId: number,
        body: string,
    ): Promise<void> {
        const trimmed = body.trim();
        if (!trimmed) {
            throw new EasyReviewError("unknown", "Comment body is required.");
        }

        const updated = await github.updateIssueComment(requireToken(), repository, commentId, trimmed);
        const key = pullRequestKey(repository, number);
        const conversationItems = resolveConversationItems(key);

        state.setState((prev) => {
            const nextItems = conversationItems.map((entry) =>
                entry.kind === "comment" && entry.databaseId === commentId
                    ? {
                          ...entry,
                          body: updated.body,
                          lastEditedAt: updated.lastEditedAt,
                          editor: updated.editor,
                          editCount: updated.editCount,
                          edits: updated.edits,
                      }
                    : entry,
            );
            queryClient.setQueryData<ConversationQueryData>(queryKeys.pullRequest.conversation(key), {
                items: nextItems,
            });
            return {
                ...prev,
                conversationComments: {
                    ...prev.conversationComments,
                    [key]: {
                        status: "ready",
                        items: nextItems,
                        error: null,
                    },
                },
            };
        });
    }

    async function updateReviewComment(
        repository: string,
        number: number,
        commentId: number,
        body: string,
    ): Promise<void> {
        const trimmed = body.trim();
        if (!trimmed) {
            throw new EasyReviewError("unknown", "Comment body is required.");
        }

        await github.updateReviewComment(requireToken(), repository, commentId, trimmed);
        await refreshAfterMutation(repository, number, { reloadReviewSurfaces: true });
    }

    async function updatePullRequestReview(
        repository: string,
        number: number,
        reviewId: string,
        body: string,
    ): Promise<void> {
        await github.updatePullRequestReview(requireToken(), reviewId, body);
        const key = pullRequestKey(repository, number);
        const conversationItems = resolveConversationItems(key);
        const nextItems = conversationItems.map((entry) =>
            entry.kind === "review" && entry.id === reviewId ? { ...entry, body } : entry,
        );
        queryClient.setQueryData<ConversationQueryData>(queryKeys.pullRequest.conversation(key), {
            items: nextItems,
        });
        state.setState((prev) => ({
            ...prev,
            conversationComments: {
                ...prev.conversationComments,
                [key]: {
                    status: "ready",
                    items: nextItems,
                    error: null,
                },
            },
        }));
    }

    async function closePullRequest(repository: string, number: number): Promise<void> {
        await github.closePullRequest(requireToken(), repository, number);
        await refreshAfterMutation(repository, number, { reloadStack: true });
    }

    async function uploadPullRequestMedia(
        repository: string,
        number: number,
        file: File,
    ): Promise<{ url: string; markdown: string }> {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return github.uploadPullRequestMedia(requireToken(), {
            repository,
            number,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            bytes,
        });
    }

    async function resolveUserAttachment(repository: string, attachmentUrl: string) {
        return github.resolveUserAttachment(requireToken(), repository, attachmentUrl);
    }

    async function resolveRepoBlobMedia(mediaUrl: string) {
        return github.resolveRepoBlobMedia(requireToken(), mediaUrl);
    }

    /** Visible sections in the user's layout order, empty ones included when not hidden. */
    function getInboxSections(): Array<InboxSection> {
        const { repos, inbox } = state.state;
        const selected = new Set(repos.selected);
        const queryData = readInboxQueryData();
        const sectionPullRequests = Object.fromEntries(
            Object.entries(queryData.sectionPullRequests).map(([sectionId, pullRequests]) => [
                sectionId,
                pullRequests.filter((pullRequest) => selected.has(pullRequest.repository)),
            ]),
        );

        return inboxSectionsFromLoaded(
            visibleSectionDefinitions(inbox.sectionLayout),
            sectionPullRequests,
            queryData.sectionCounts,
        );
    }

    /**
     * Command-palette fallback: pull requests matching `query` by title, branch, number,
     * or pasted GitHub PR URL. Newest updated first.
     */
    async function searchPullRequests(query: string): Promise<Array<PullRequestSummary>> {
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }

        const link = parsePullRequestUrl(trimmed);
        const selected = state.state.repos.selected;
        const selectedSet = new Set(selected);
        const byKey = new Map<string, PullRequestSummary>();

        // URL paste is explicit: resolve that PR even when the allowlist is empty.
        if (link) {
            const cached = state.state.inbox.pullRequests.find(
                (pullRequest) =>
                    pullRequest.repository.toLowerCase() === link.repository.toLowerCase() &&
                    pullRequest.number === link.number,
            );
            if (cached) {
                return [cached];
            }

            try {
                return await github.searchPullRequests(requireToken(), {
                    query: trimmed,
                    repositories: [link.repository],
                    limit: 1,
                });
            } catch {
                return [];
            }
        }

        if (selected.length === 0) {
            return [];
        }

        for (const pullRequest of state.state.inbox.pullRequests) {
            if (selectedSet.has(pullRequest.repository) && matchesPullRequestSearchQuery(pullRequest, trimmed)) {
                byKey.set(pullRequest.key, pullRequest);
            }
        }

        try {
            const remote = await github.searchPullRequests(requireToken(), {
                query: trimmed,
                repositories: selected,
                limit: 25,
            });
            for (const pullRequest of remote) {
                byKey.set(pullRequest.key, pullRequest);
            }
        } catch {
            // Inbox matches alone are still useful when search is rate-limited.
        }

        return [...byKey.values()].sort(comparePullRequestsByUpdatedAtDesc).slice(0, 25);
    }

    return {
        state,
        github,
        queryClient,
        requireToken,
        restore,
        connect,
        beginOAuthLogin,
        reportAuthError,
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
        invalidateInbox,
        syncInboxData: syncInboxQueryData,
        canLoadMoreInboxSection,
        loadMoreInboxSection,
        toggleSection,
        getSectionLayout,
        setSectionHidden,
        setSectionLabel,
        setSectionColor,
        setSectionCustomColor,
        setSectionIcon,
        setSectionDefaultExpanded,
        setSectionFilter,
        resetSectionFilter,
        addCustomSection,
        duplicateSection,
        deleteSection,
        moveSection,
        reorderVisibleSection,
        resetSectionLayout,
        getInboxSettings,
        exportInboxSection,
        importInboxSettings,
        importInboxSection,
        previewSectionFilter,
        getInboxSections,
        loadPullRequest,
        refreshPullRequest,
        revalidatePullRequest,
        getPullRequestPage,
        searchPullRequests,
        loadPullRequestFiles,
        refreshPullRequestFiles,
        loadFileDiff,
        getFileDiff,
        listComparedFiles,
        getFileDiffBetween,
        getReviewDraft,
        setReviewEvent,
        setReviewBody,
        addPendingComment,
        addSingleLineComment,
        updatePendingComment,
        removePendingComment,
        discardReviewDraft,
        submitReview,
        loadReviewThreads,
        getReviewThreads,
        replyToReviewThread,
        setReviewThreadResolved,
        loadConversationComments,
        getConversationComments,
        loadPullRequestCommits,
        getPullRequestCommits,
        loadRelatedPullRequests,
        getRelatedPullRequests,
        getPullRequestStack,
        addPullRequestComment,
        loadRepositoryMetadata,
        getRepositoryMetadata,
        setPullRequestDraft,
        setPullRequestFileViewed,
        setPullRequestLabels,
        setPullRequestAssignees,
        setReviewRequests,
        reRequestReview,
        dismissReview,
        updatePullRequestBody,
        applySuggestions,
        updatePullRequest,
        listRepositoryBranches,
        toggleIssueReaction,
        toggleIssueCommentReaction,
        toggleReviewCommentReaction,
        mergePullRequest,
        mergePullRequestStack,
        reopenPullRequest,
        updatePullRequestBranch,
        enablePullRequestAutoMerge,
        disablePullRequestAutoMerge,
        updateIssueComment,
        updateReviewComment,
        updatePullRequestReview,
        closePullRequest,
        uploadPullRequestMedia,
        resolveUserAttachment,
        resolveRepoBlobMedia,
    };
}

function toInboxSummary(detail: PullRequestDetail): PullRequestSummary {
    return {
        key: detail.key,
        repository: detail.repository,
        number: detail.number,
        title: detail.title,
        url: detail.url,
        author: detail.author,
        authorAvatarUrl: detail.authorAvatarUrl,
        state: detail.state,
        isDraft: detail.isDraft,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        mergedAt: detail.mergedAt,
        headRefName: detail.headRefName,
        baseRefName: detail.baseRefName,
        reviewDecision: detail.reviewDecision,
        reviewRequests: detail.reviewRequests,
        reviewers: detail.reviewers,
        checks: detail.checks,
        additions: detail.additions,
        deletions: detail.deletions,
        changedFiles: detail.changedFiles,
        commentCount: detail.commentCount,
        mergeable: detail.mergeable,
        mergeStateStatus: detail.mergeStateStatus,
        assignees: detail.assignees,
        labels: detail.labels,
        githubStack: detail.githubStack ?? null,
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
