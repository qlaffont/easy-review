import type {
    GithubClient,
    GithubViewer,
    GetFileDiffOptions,
    InboxPullRequestPagination,
    ListPullRequestsOptions,
    ListPullRequestsResult,
} from "#/lib/session/ports.ts";
import type {
    FileDiff,
    Label,
    MergeMethod,
    MergePullRequestOptions,
    MergeCommitPreview,
    PullRequestComment,
    PullRequestCommit,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    PullRequestTimelineItem,
    ReactionContent,
    ReactionGroup,
    Repository,
    RepositoryLabel,
    RepositoryUser,
    ReviewEvent,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import {
    MERGED_PULL_REQUESTS_PER_REPOSITORY,
    OPEN_PULL_REQUESTS_PER_REPOSITORY,
} from "#/lib/session/adapters/github-http-client.ts";
import { applySuggestionsToFile } from "#/lib/session/apply-suggestion.ts";
import { buildFileDiff } from "#/lib/session/build-file-diff.ts";
import { stubForPath } from "#/lib/session/diff-policy.ts";
import { EasyReviewError, unauthorized } from "#/lib/session/errors.ts";
import {
    buildScopedSearchQueryBatches,
    comparePullRequestsByUpdatedAtDesc,
    matchesPullRequestSearchQuery,
} from "#/lib/session/pull-request-search.ts";
import { matchesRelatedRefs } from "#/lib/session/related-pull-requests.ts";
import { matchesSectionSearchCountQuery } from "#/lib/session/section-filters.ts";
import { DEFAULT_MERGE_COMMIT_SETTINGS } from "#/lib/session/types.ts";

export type FakeGithub = GithubClient & {
    /** Register a token GitHub will accept, together with the account behind it. */
    addAccount(token: string, viewer?: Partial<GithubViewer>): GithubViewer;
    /** Make a repository visible to a token. */
    addRepository(token: string, nameWithOwner: string, repository?: Partial<Repository>): Repository;
    /** Seed assignable users for a repository. */
    setRepositoryAssignees(token: string, repository: string, users: Array<RepositoryUser>): void;
    /** Seed labels for a repository. */
    setRepositoryLabels(token: string, repository: string, labels: Array<RepositoryLabel>): void;
    /** Default branch used when rendering stack trunk labels. */
    setRepositoryDefaultBranch(token: string, repository: string, defaultBranch: string): void;
    /** Add a pull request to a repository. */
    addPullRequest(token: string, pullRequest: PullRequestInput): PullRequestDetail;
    /** Seed the files (and optional before/after text) for a pull request. */
    setPullRequestFiles(token: string, repository: string, number: number, files: Array<FakeFileInput>): void;
    /** Repository sets asked for, one entry per `listPullRequests` call. */
    pullRequestQueries: Array<ReadonlyArray<string>>;
    /** Options passed to each `listPullRequests` call, in order. */
    pullRequestQueryOptions: Array<ListPullRequestsOptions | undefined>;
    /** Related-PR scans, one entry per `listRelatedPullRequests` call. */
    relatedPullRequestQueries: Array<{
        repositories: ReadonlyArray<string>;
        headRefName: string;
        baseRefName: string;
    }>;
    /** Stack index loads, one entry per `listRepositoryStackIndex` call. */
    stackIndexQueries: Array<string>;
    /** Paths asked for via `getPullRequestFileDiff`, in order. */
    fileDiffQueries: Array<string>;
    /** Submitted reviews, in order. */
    submittedReviews: Array<{
        repository: string;
        number: number;
        headSha: string;
        event: ReviewEvent;
        body: string;
        comments: Array<{ path: string; line: number; side: string; body: string }>;
    }>;
    /** Seed an existing review thread on a pull request. */
    addReviewThread(token: string, repository: string, number: number, thread: ReviewThread): void;
    /** Seed a conversation comment on a pull request. */
    addConversationComment(token: string, repository: string, number: number, comment: PullRequestComment): void;
    /** Seed a timeline event (commit, assignment, rename, …). */
    addTimelineItem(token: string, repository: string, number: number, item: PullRequestTimelineItem): void;
    /** Move the head SHA so draft invalidation can be exercised. */
    setPullRequestHead(token: string, repository: string, number: number, headSha: string): void;
    /** Patch stored pull request fields (title, refs, timestamps, …). */
    patchPullRequest(
        token: string,
        repository: string,
        number: number,
        patch: Partial<PullRequestDetail>,
    ): PullRequestDetail;
    /** Revoke a token so the next call with it fails as unauthorized. */
    revokeAccount(token: string): void;
    /** Make the next call fail, whatever the token. */
    failNextWith(error: EasyReviewError): void;
    /** Make every call fail until {@link clearFailures} is called. */
    failAllWith(error: EasyReviewError): void;
    /** Clear {@link failAllWith}. */
    clearFailures(): void;
    /** Hold the next call in flight until the returned function is called. */
    deferNext(): () => void;
    /** Names of the client methods called so far, in order. */
    calls: Array<string>;
};

export type PullRequestInput = Partial<PullRequestDetail> & { repository: string; number: number };

export type FakeFileInput = {
    path: string;
    previousPath?: string | null;
    status?: PullRequestFile["status"];
    additions?: number;
    deletions?: number;
    /** Text on the base side. Omit for an added file. */
    before?: string | null;
    /** Text on the head side. Omit for a removed file. */
    after?: string | null;
    /** Raw bytes override text — used to seed binary fixtures. */
    beforeBytes?: Uint8Array | null;
    afterBytes?: Uint8Array | null;
};

type StoredFile = PullRequestFile & {
    before: Uint8Array | null;
    after: Uint8Array | null;
};

function buildPullRequest(input: PullRequestInput): PullRequestDetail {
    return {
        key: `${input.repository}#${input.number}`,
        repository: input.repository,
        number: input.number,
        title: input.title ?? `Pull request ${input.number}`,
        url: input.url ?? `https://github.com/${input.repository}/pull/${input.number}`,
        author: input.author ?? "octocat",
        authorAvatarUrl: input.authorAvatarUrl ?? null,
        state: input.state ?? "open",
        isDraft: input.isDraft ?? false,
        createdAt: input.createdAt ?? "2026-07-01T00:00:00.000Z",
        updatedAt: input.updatedAt ?? "2026-07-02T00:00:00.000Z",
        mergedAt: input.mergedAt ?? null,
        headRefName: input.headRefName ?? `feature-${input.number}`,
        baseRefName: input.baseRefName ?? "main",
        reviewDecision: input.reviewDecision ?? null,
        reviewRequests: input.reviewRequests ?? [],
        reviewers: (input.reviewers ?? []).map((reviewer, index) => ({
            login: reviewer.login,
            state: reviewer.state,
            reviewId: reviewer.reviewId ?? index + 1,
        })),
        checks: input.checks ?? "none",
        additions: input.additions ?? 0,
        deletions: input.deletions ?? 0,
        changedFiles: input.changedFiles ?? 0,
        commentCount: input.commentCount ?? 0,
        body: input.body ?? "",
        lastEditedAt: input.lastEditedAt ?? null,
        editor: input.editor ?? null,
        editCount: input.editCount ?? 0,
        edits: input.edits ?? [],
        reactionGroups: input.reactionGroups ?? [],
        headSha: input.headSha ?? `sha-head-${input.number}`,
        baseSha: input.baseSha ?? `sha-base-${input.number}`,
        labels: input.labels ?? [],
        assignees: input.assignees ?? [],
        checkRuns: input.checkRuns ?? [],
        checkCount: input.checkCount ?? input.checkRuns?.length ?? 0,
        mergeable: input.mergeable ?? "mergeable",
        requiredApprovingReviewCount:
            input.requiredApprovingReviewCount ?? (input.reviewDecision === "review-required" ? 1 : null),
        allowedMergeMethods: input.allowedMergeMethods ?? ["merge", "squash", "rebase"],
        defaultMergeMethod: input.defaultMergeMethod ?? "squash",
        commitCount: input.commitCount ?? 1,
        headRepositoryOwnerLogin: input.headRepositoryOwnerLogin ?? input.repository.split("/")[0] ?? "octocat",
        mergeCommits:
            input.mergeCommits ??
            ([
                {
                    oid: input.headSha ?? `sha-head-${input.number}`,
                    messageHeadline: input.title ?? `Pull request ${input.number}`,
                    message: input.body ?? "",
                },
            ] satisfies Array<MergeCommitPreview>),
        mergeCommitSettings: input.mergeCommitSettings ?? DEFAULT_MERGE_COMMIT_SETTINGS,
        mergeStateStatus:
            input.mergeStateStatus ??
            (input.isDraft
                ? "draft"
                : input.reviewDecision === "review-required" || input.reviewDecision === "changes-requested"
                  ? "blocked"
                  : input.checks === "failure"
                    ? "unstable"
                    : input.mergeable === "conflicting"
                      ? "dirty"
                      : "clean"),
        viewerCanMergeAsAdmin: input.viewerCanMergeAsAdmin ?? false,
    };
}

/** Fields the Inbox batch query asks for. Anything else is only on the overview. */
const SUMMARY_FIELDS = [
    "key",
    "repository",
    "number",
    "title",
    "url",
    "author",
    "authorAvatarUrl",
    "state",
    "isDraft",
    "createdAt",
    "updatedAt",
    "mergedAt",
    "headRefName",
    "baseRefName",
    "reviewDecision",
    "reviewRequests",
    "reviewers",
    "checks",
    "additions",
    "deletions",
    "changedFiles",
    "commentCount",
    "mergeable",
    "assignees",
    "labels",
] as const satisfies ReadonlyArray<keyof PullRequestSummary>;

/** The Inbox only ever sees the row-shaped fields, exactly as the real batch query returns. */
function toSummary(detail: PullRequestDetail): PullRequestSummary {
    return Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, detail[field]])) as PullRequestSummary;
}

function encode(text: string | null | undefined): Uint8Array | null {
    if (text === null || text === undefined) {
        return null;
    }

    return new TextEncoder().encode(text);
}

function filesKey(token: string, repository: string, number: number): string {
    return `${token}:${repository}#${number}`;
}

export function createFakeGithub(): FakeGithub {
    const accounts = new Map<string, GithubViewer>();
    const repositoriesByToken = new Map<string, Array<Repository>>();
    const pullRequestsByToken = new Map<string, Array<PullRequestDetail>>();
    const filesByPullRequest = new Map<string, Array<StoredFile>>();
    const viewedFilesByPullRequest = new Map<string, Set<string>>();
    const threadsByPullRequest = new Map<string, Array<ReviewThread>>();
    const timelineByPullRequest = new Map<string, Array<PullRequestTimelineItem>>();
    const assigneesByRepository = new Map<string, Array<RepositoryUser>>();
    const labelsByRepository = new Map<string, Array<RepositoryLabel>>();
    const defaultBranchByRepository = new Map<string, string>();
    const pullRequestQueries: Array<ReadonlyArray<string>> = [];
    const pullRequestQueryOptions: Array<ListPullRequestsOptions | undefined> = [];
    const relatedPullRequestQueries: FakeGithub["relatedPullRequestQueries"] = [];
    const stackIndexQueries: FakeGithub["stackIndexQueries"] = [];
    const fileDiffQueries: Array<string> = [];
    const submittedReviews: FakeGithub["submittedReviews"] = [];
    const calls: Array<string> = [];
    let forcedError: EasyReviewError | null = null;
    let forcedErrorAll: EasyReviewError | null = null;
    let gate: Promise<void> | null = null;
    let replyCounter = 0;
    let conversationCommentCounter = 0;
    let reactionCounter = 0;
    const issueReactions = new Map<string, Array<{ id: number; content: ReactionContent; user: string }>>();
    const commentReactions = new Map<number, Array<{ id: number; content: ReactionContent; user: string }>>();
    const reviewCommentReactions = new Map<number, Array<{ id: number; content: ReactionContent; user: string }>>();

    function reactionGroupsFrom(
        rows: Array<{ content: ReactionContent; user: string }>,
        viewerLogin: string,
    ): Array<ReactionGroup> {
        const byContent = new Map<ReactionContent, ReactionGroup>();
        for (const row of rows) {
            const current = byContent.get(row.content) ?? {
                content: row.content,
                count: 0,
                viewerHasReacted: false,
            };
            current.count += 1;
            if (row.user === viewerLogin) {
                current.viewerHasReacted = true;
            }
            byContent.set(row.content, current);
        }
        return [...byContent.values()];
    }

    function syncIssueReactions(token: string, repository: string, number: number) {
        const viewer = accounts.get(token)?.login ?? "";
        const rows = issueReactions.get(filesKey(token, repository, number)) ?? [];
        patchPullRequest(token, repository, number, {
            reactionGroups: reactionGroupsFrom(rows, viewer),
        });
    }

    function syncCommentReactions(token: string, repository: string, number: number, commentId: number) {
        const viewer = accounts.get(token)?.login ?? "";
        const rows = commentReactions.get(commentId) ?? [];
        const groups = reactionGroupsFrom(rows, viewer);
        const key = filesKey(token, repository, number);
        const timeline = timelineByPullRequest.get(key) ?? [];
        timelineByPullRequest.set(
            key,
            timeline.map((item) =>
                item.kind === "comment" && item.databaseId === commentId ? { ...item, reactionGroups: groups } : item,
            ),
        );
    }

    function syncReviewCommentReactions(commentId: number, viewerLogin: string) {
        const rows = reviewCommentReactions.get(commentId) ?? [];
        const groups = reactionGroupsFrom(rows, viewerLogin);

        for (const [key, threads] of threadsByPullRequest) {
            let changed = false;
            const next = threads.map((thread) => ({
                ...thread,
                comments: thread.comments.map((comment) => {
                    if (comment.databaseId !== commentId) {
                        return comment;
                    }
                    changed = true;
                    return { ...comment, reactionGroups: groups };
                }),
            }));
            if (changed) {
                threadsByPullRequest.set(key, next);
            }
        }
    }

    function authenticate(token: string): GithubViewer {
        if (forcedErrorAll) {
            throw forcedErrorAll;
        }

        if (forcedError) {
            const error = forcedError;
            forcedError = null;
            throw error;
        }

        const viewer = accounts.get(token);

        if (!viewer) {
            throw unauthorized();
        }

        return viewer;
    }

    async function respond<TResult>(method: string, produce: () => TResult): Promise<TResult> {
        calls.push(method);
        const pending = gate;
        gate = null;

        if (pending) {
            await pending;
        }

        return produce();
    }

    function requirePullRequest(token: string, repository: string, number: number): PullRequestDetail {
        const found = (pullRequestsByToken.get(token) ?? []).find(
            (pullRequest) => pullRequest.repository === repository && pullRequest.number === number,
        );

        if (!found) {
            throw new EasyReviewError(
                "not-found",
                `${repository}#${number} does not exist, or this session cannot see it.`,
            );
        }

        return found;
    }

    function patchPullRequest(
        token: string,
        repository: string,
        number: number,
        patch: Partial<PullRequestDetail>,
    ): PullRequestDetail {
        const list = pullRequestsByToken.get(token) ?? [];
        pullRequestsByToken.set(
            token,
            list.map((pullRequest) =>
                pullRequest.repository === repository && pullRequest.number === number
                    ? { ...pullRequest, ...patch, updatedAt: new Date().toISOString() }
                    : pullRequest,
            ),
        );
        return requirePullRequest(token, repository, number);
    }

    function requireOpen(pullRequest: PullRequestDetail): void {
        if (pullRequest.state !== "open") {
            throw new EasyReviewError("unknown", `${pullRequest.repository}#${pullRequest.number} is not open.`);
        }
    }

    function parseInboxCursor(cursor: string | undefined): number {
        if (!cursor) {
            return 0;
        }

        const parsed = Number.parseInt(cursor, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    function paginatePullRequests(
        pullRequests: Array<PullRequestSummary>,
        pageSize: number,
        cursor: string | undefined,
    ) {
        const offset = parseInboxCursor(cursor);
        const nodes = pullRequests.slice(offset, offset + pageSize);
        const nextOffset = offset + pageSize;

        return {
            nodes,
            pageInfo: {
                hasNextPage: nextOffset < pullRequests.length,
                endCursor: nextOffset < pullRequests.length ? String(nextOffset) : null,
            },
        };
    }

    return {
        calls,
        pullRequestQueries,
        pullRequestQueryOptions,
        relatedPullRequestQueries,
        stackIndexQueries,
        fileDiffQueries,
        submittedReviews,
        addAccount(token, viewer) {
            const account: GithubViewer = {
                login: viewer?.login ?? "octocat",
                name: viewer?.name ?? "The Octocat",
                avatarUrl: viewer?.avatarUrl ?? null,
            };
            accounts.set(token, account);
            return account;
        },
        addRepository(token, nameWithOwner, repository) {
            const [owner = "", name = ""] = nameWithOwner.split("/");
            const entry: Repository = {
                nameWithOwner,
                owner,
                name,
                isPrivate: repository?.isPrivate ?? false,
                isArchived: repository?.isArchived ?? false,
                pushedAt: repository?.pushedAt ?? null,
            };

            repositoriesByToken.set(token, [...(repositoriesByToken.get(token) ?? []), entry]);
            const repoKey = `${token}:${nameWithOwner}`;
            if (!assigneesByRepository.has(repoKey)) {
                assigneesByRepository.set(repoKey, [
                    {
                        login: accounts.get(token)?.login ?? "octocat",
                        name: accounts.get(token)?.name ?? null,
                        avatarUrl: accounts.get(token)?.avatarUrl ?? null,
                    },
                    { login: "hubot", name: "Hubot", avatarUrl: null },
                    { login: "mona", name: "Mona Lisa", avatarUrl: null },
                ]);
            }
            if (!labelsByRepository.has(repoKey)) {
                labelsByRepository.set(repoKey, [
                    { name: "bug", color: "d73a4a", description: "Something isn't working" },
                    { name: "enhancement", color: "a2eeef", description: "New feature or request" },
                    {
                        name: "documentation",
                        color: "0075ca",
                        description: "Improvements or additions to documentation",
                    },
                ]);
            }
            if (!defaultBranchByRepository.has(repoKey)) {
                defaultBranchByRepository.set(repoKey, "main");
            }
            return entry;
        },
        setRepositoryAssignees(token, repository, users) {
            assigneesByRepository.set(`${token}:${repository}`, [...users]);
        },
        setRepositoryLabels(token, repository, labels) {
            labelsByRepository.set(`${token}:${repository}`, [...labels]);
        },
        setRepositoryDefaultBranch(token, repository, defaultBranch) {
            defaultBranchByRepository.set(`${token}:${repository}`, defaultBranch);
        },
        addPullRequest(token, input) {
            const pullRequest = buildPullRequest(input);
            pullRequestsByToken.set(token, [...(pullRequestsByToken.get(token) ?? []), pullRequest]);
            const repoKey = `${token}:${input.repository}`;
            if (!assigneesByRepository.has(repoKey)) {
                assigneesByRepository.set(repoKey, [
                    {
                        login: accounts.get(token)?.login ?? "octocat",
                        name: accounts.get(token)?.name ?? null,
                        avatarUrl: accounts.get(token)?.avatarUrl ?? null,
                    },
                    { login: "hubot", name: "Hubot", avatarUrl: null },
                    { login: "mona", name: "Mona Lisa", avatarUrl: null },
                ]);
            }
            if (!labelsByRepository.has(repoKey)) {
                labelsByRepository.set(repoKey, [
                    { name: "bug", color: "d73a4a", description: "Something isn't working" },
                    { name: "enhancement", color: "a2eeef", description: "New feature or request" },
                    {
                        name: "documentation",
                        color: "0075ca",
                        description: "Improvements or additions to documentation",
                    },
                ]);
            }
            return pullRequest;
        },
        addReviewThread(token, repository, number, thread) {
            const key = filesKey(token, repository, number);
            threadsByPullRequest.set(key, [...(threadsByPullRequest.get(key) ?? []), thread]);
        },
        addConversationComment(token, repository, number, comment) {
            const key = filesKey(token, repository, number);
            timelineByPullRequest.set(key, [
                ...(timelineByPullRequest.get(key) ?? []),
                { kind: "comment", ...comment },
            ]);
        },
        addTimelineItem(token, repository, number, item) {
            const key = filesKey(token, repository, number);
            timelineByPullRequest.set(key, [...(timelineByPullRequest.get(key) ?? []), item]);
        },
        setPullRequestHead(token, repository, number, headSha) {
            const list = pullRequestsByToken.get(token) ?? [];
            pullRequestsByToken.set(
                token,
                list.map((pullRequest) =>
                    pullRequest.repository === repository && pullRequest.number === number
                        ? { ...pullRequest, headSha }
                        : pullRequest,
                ),
            );
        },
        patchPullRequest(token, repository, number, patch) {
            return patchPullRequest(token, repository, number, patch);
        },
        setPullRequestFiles(token, repository, number, files) {
            filesByPullRequest.set(
                filesKey(token, repository, number),
                files.map((file) => {
                    const status = file.status ?? "modified";

                    return {
                        path: file.path,
                        previousPath: file.previousPath ?? null,
                        status,
                        additions: file.additions ?? 0,
                        deletions: file.deletions ?? 0,
                        stub: stubForPath(file.path),
                        before:
                            file.beforeBytes !== undefined
                                ? file.beforeBytes
                                : status === "added"
                                  ? null
                                  : encode(file.before ?? ""),
                        after:
                            file.afterBytes !== undefined
                                ? file.afterBytes
                                : status === "removed"
                                  ? null
                                  : encode(file.after ?? ""),
                    };
                }),
            );
        },
        revokeAccount(token) {
            accounts.delete(token);
            repositoriesByToken.delete(token);
            pullRequestsByToken.delete(token);

            for (const key of [
                ...filesByPullRequest.keys(),
                ...threadsByPullRequest.keys(),
                ...timelineByPullRequest.keys(),
            ]) {
                if (key.startsWith(`${token}:`)) {
                    filesByPullRequest.delete(key);
                    threadsByPullRequest.delete(key);
                    timelineByPullRequest.delete(key);
                }
            }
        },
        failNextWith(error) {
            forcedError = error;
        },
        failAllWith(error) {
            forcedErrorAll = error;
        },
        clearFailures() {
            forcedErrorAll = null;
            forcedError = null;
        },
        deferNext() {
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            gate = held;

            return () => {
                if (gate === held) {
                    gate = null;
                }
                release();
            };
        },
        getViewer(token) {
            return respond("getViewer", () => authenticate(token));
        },
        listRepositories(token) {
            return respond("listRepositories", () => {
                authenticate(token);
                return repositoriesByToken.get(token) ?? [];
            });
        },
        listPullRequests(token, repositories, options) {
            pullRequestQueries.push(repositories);
            pullRequestQueryOptions.push(options);

            return respond("listPullRequests", (): ListPullRequestsResult => {
                authenticate(token);
                const fetchOpen = !options?.states || options.states.includes("open");
                const fetchMerged = !options?.states || options.states.includes("merged");
                const pullRequests: Array<PullRequestSummary> = [];
                const pagination: Record<string, Partial<InboxPullRequestPagination>> = {};

                for (const repository of repositories) {
                    const inRepository = (pullRequestsByToken.get(token) ?? []).filter(
                        (pullRequest) => pullRequest.repository === repository,
                    );
                    const repoPagination: Partial<InboxPullRequestPagination> = {};

                    if (fetchOpen) {
                        const openPullRequests = inRepository
                            .filter((pullRequest) => pullRequest.state === "open")
                            .sort(comparePullRequestsByUpdatedAtDesc)
                            .map(toSummary);
                        const page = paginatePullRequests(
                            openPullRequests,
                            OPEN_PULL_REQUESTS_PER_REPOSITORY,
                            options?.cursors?.[repository]?.open,
                        );
                        pullRequests.push(...page.nodes);
                        repoPagination.open = page.pageInfo;
                    }

                    if (fetchMerged) {
                        const mergedPullRequests = inRepository
                            .filter((pullRequest) => pullRequest.state === "merged")
                            .sort(comparePullRequestsByUpdatedAtDesc)
                            .map(toSummary);
                        const page = paginatePullRequests(
                            mergedPullRequests,
                            MERGED_PULL_REQUESTS_PER_REPOSITORY,
                            options?.cursors?.[repository]?.merged,
                        );
                        pullRequests.push(...page.nodes);
                        repoPagination.merged = page.pageInfo;
                    }

                    pagination[repository] = repoPagination;
                }

                return { pullRequests, pagination };
            });
        },
        searchPullRequests(token, input) {
            return respond("searchPullRequests", () => {
                authenticate(token);
                const needle = input.query.trim();
                if (!needle || input.repositories.length === 0) {
                    return [];
                }
                const wanted = new Set(input.repositories);
                const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
                return (pullRequestsByToken.get(token) ?? [])
                    .filter(
                        (pullRequest) =>
                            wanted.has(pullRequest.repository) && matchesPullRequestSearchQuery(pullRequest, needle),
                    )
                    .sort(comparePullRequestsByUpdatedAtDesc)
                    .slice(0, limit)
                    .map(toSummary);
            });
        },
        countPullRequests(token, input) {
            return respond("countPullRequests", () => {
                authenticate(token);
                const query = input.query.trim();
                if (!query || input.repositories.length === 0) {
                    return 0;
                }

                const viewerLogin = accounts.get(token)?.login ?? "";
                const batches = buildScopedSearchQueryBatches(query, input.repositories);
                let total = 0;

                for (const batchQuery of batches) {
                    const reposInBatch = new Set(
                        [...batchQuery.matchAll(/\srepo:([^\s]+)/g)].map((match) => match[1]!),
                    );
                    const baseQuery = batchQuery.replace(/\srepo:[^\s]+/g, "").trim();

                    total += (pullRequestsByToken.get(token) ?? []).filter(
                        (pullRequest) =>
                            reposInBatch.has(pullRequest.repository) &&
                            matchesSectionSearchCountQuery(toSummary(pullRequest), baseQuery, viewerLogin),
                    ).length;
                }

                return total;
            });
        },
        fetchSectionPullRequests(token, input) {
            return respond("fetchSectionPullRequests", () => {
                authenticate(token);
                const query = input.query.trim();
                if (!query || input.repositories.length === 0) {
                    return {
                        pullRequests: [],
                        totalCount: 0,
                        pageInfo: { hasNextPage: false, endCursor: null },
                    };
                }

                const viewerLogin = accounts.get(token)?.login ?? "";
                const wanted = new Set(input.repositories);
                const baseQuery = query.replace(/\ssort:updated-desc$/, "").trim();
                const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
                const offset = input.after ? Number(input.after) : 0;

                const matching = (pullRequestsByToken.get(token) ?? [])
                    .filter(
                        (pullRequest) =>
                            wanted.has(pullRequest.repository) &&
                            matchesSectionSearchCountQuery(toSummary(pullRequest), baseQuery, viewerLogin),
                    )
                    .sort(comparePullRequestsByUpdatedAtDesc);

                const pullRequests = matching.slice(offset, offset + limit).map(toSummary);
                const totalCount = matching.length;
                const nextOffset = offset + pullRequests.length;

                return {
                    pullRequests,
                    totalCount,
                    pageInfo: {
                        hasNextPage: nextOffset < totalCount,
                        endCursor: nextOffset < totalCount ? String(nextOffset) : null,
                    },
                };
            });
        },
        listRelatedPullRequests(token, input) {
            relatedPullRequestQueries.push({
                repositories: input.repositories,
                headRefName: input.headRefName,
                baseRefName: input.baseRefName,
            });

            return respond("listRelatedPullRequests", () => {
                authenticate(token);
                const wanted = new Set(input.repositories);
                return (pullRequestsByToken.get(token) ?? [])
                    .filter(
                        (pullRequest) =>
                            pullRequest.state !== "closed" &&
                            wanted.has(pullRequest.repository) &&
                            matchesRelatedRefs(pullRequest, input.headRefName, input.baseRefName),
                    )
                    .map(toSummary);
            });
        },
        listRepositoryStackIndex(token, repository) {
            stackIndexQueries.push(repository);

            return respond("listRepositoryStackIndex", () => {
                authenticate(token);
                return {
                    defaultBranch: defaultBranchByRepository.get(`${token}:${repository}`) ?? "main",
                    pullRequests: (pullRequestsByToken.get(token) ?? [])
                        .filter((pullRequest) => pullRequest.repository === repository)
                        .map(toSummary),
                };
            });
        },
        getPullRequest(token, repository, number) {
            return respond("getPullRequest", () => {
                authenticate(token);
                return requirePullRequest(token, repository, number);
            });
        },
        listRepositoryAssignees(token, repository) {
            return respond("listRepositoryAssignees", () => {
                authenticate(token);
                return [...(assigneesByRepository.get(`${token}:${repository}`) ?? [])];
            });
        },
        listRepositoryLabels(token, repository) {
            return respond("listRepositoryLabels", () => {
                authenticate(token);
                return [...(labelsByRepository.get(`${token}:${repository}`) ?? [])];
            });
        },
        listPullRequestFiles(token, repository, number) {
            return respond("listPullRequestFiles", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                const stored = filesByPullRequest.get(filesKey(token, repository, number)) ?? [];
                return stored.map(({ before: _before, after: _after, ...file }) => file);
            });
        },
        listComparedFiles(token, _repository, baseOid, headOid) {
            return respond("listComparedFiles", () => {
                authenticate(token);
                if (!baseOid || !headOid || baseOid === headOid) {
                    return [];
                }
                // Tests reuse the PR file list as a stand-in for any compare range.
                for (const [key, stored] of filesByPullRequest) {
                    if (!key.startsWith(`${token}:`)) {
                        continue;
                    }
                    return stored.map(({ before: _before, after: _after, ...file }) => file);
                }
                return [];
            });
        },
        getPullRequestFileDiff(token, repository, number, path, options?: GetFileDiffOptions) {
            fileDiffQueries.push(path);

            return respond("getPullRequestFileDiff", (): FileDiff => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                const force = options?.force === true;
                const pathStub = stubForPath(path);

                if (pathStub === "binary" || (pathStub && !force)) {
                    return { path, lines: [], truncated: false, stub: pathStub, beforeText: null, afterText: null };
                }

                const stored = (filesByPullRequest.get(filesKey(token, repository, number)) ?? []).find(
                    (file) => file.path === path,
                );

                if (!stored) {
                    throw new EasyReviewError("not-found", `${path} is not part of ${repository}#${number}.`);
                }

                return buildFileDiff({ path, before: stored.before, after: stored.after }, { force });
            });
        },
        listReviewThreads(token, repository, number) {
            return respond("listReviewThreads", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                return threadsByPullRequest.get(filesKey(token, repository, number)) ?? [];
            });
        },
        listPullRequestComments(token, repository, number) {
            return respond("listPullRequestComments", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                return (timelineByPullRequest.get(filesKey(token, repository, number)) ?? [])
                    .filter(
                        (item): item is Extract<PullRequestTimelineItem, { kind: "comment" }> =>
                            item.kind === "comment",
                    )
                    .map(({ kind: _kind, ...comment }) => comment);
            });
        },
        listPullRequestTimeline(token, repository, number) {
            return respond("listPullRequestTimeline", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                return [...(timelineByPullRequest.get(filesKey(token, repository, number)) ?? [])];
            });
        },
        listPullRequestCommits(token, repository, number) {
            return respond("listPullRequestCommits", (): Array<PullRequestCommit> => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                const fromTimeline = (timelineByPullRequest.get(filesKey(token, repository, number)) ?? [])
                    .filter(
                        (item): item is Extract<PullRequestTimelineItem, { kind: "commit" }> => item.kind === "commit",
                    )
                    .map((item) => ({
                        oid: item.oid,
                        abbreviatedOid: item.abbreviatedOid,
                        messageHeadline: item.messageHeadline,
                        committedAt: item.createdAt,
                        authorLogin: item.author.login,
                        authorAvatarUrl: item.author.avatarUrl,
                        url: item.url,
                        checkState: item.checkState,
                    }));
                if (fromTimeline.length > 0) {
                    return fromTimeline;
                }
                return [
                    {
                        oid: pullRequest.headSha,
                        abbreviatedOid: pullRequest.headSha.slice(0, 7),
                        messageHeadline: pullRequest.title,
                        committedAt: pullRequest.updatedAt,
                        authorLogin: pullRequest.author,
                        authorAvatarUrl: pullRequest.authorAvatarUrl,
                        url: `https://github.com/${repository}/commit/${pullRequest.headSha}`,
                        checkState: pullRequest.checks,
                    },
                ];
            });
        },
        addPullRequestComment(token, repository, number, body) {
            return respond("addPullRequestComment", (): PullRequestComment => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                const databaseId = ++conversationCommentCounter;
                const comment: PullRequestComment = {
                    id: `issue-comment-${databaseId}`,
                    databaseId,
                    author: accounts.get(token)?.login ?? "octocat",
                    authorAvatarUrl: accounts.get(token)?.avatarUrl ?? null,
                    body,
                    createdAt: new Date().toISOString(),
                    url: `${pullRequest.url}#issuecomment-${databaseId}`,
                    lastEditedAt: null,
                    editor: null,
                    editCount: 0,
                    edits: [],
                    reactionGroups: [],
                };
                const key = filesKey(token, repository, number);
                timelineByPullRequest.set(key, [
                    ...(timelineByPullRequest.get(key) ?? []),
                    { kind: "comment", ...comment },
                ]);
                patchPullRequest(token, repository, number, {
                    commentCount: pullRequest.commentCount + 1,
                });
                return comment;
            });
        },
        submitReview(token, input) {
            return respond("submitReview", () => {
                authenticate(token);
                const account = accounts.get(token);
                requirePullRequest(token, input.repository, input.number);
                submittedReviews.push({
                    repository: input.repository,
                    number: input.number,
                    headSha: input.headSha,
                    event: input.event,
                    body: input.body,
                    comments: input.comments.map((comment) => ({ ...comment })),
                });

                const key = filesKey(token, input.repository, input.number);
                const created = input.comments.map((comment, index) => {
                    const id = `thread-${++replyCounter}-${index}`;
                    const databaseId = replyCounter;
                    return {
                        id,
                        path: comment.path,
                        startLine: null,
                        line: comment.line,
                        side: comment.side,
                        isResolved: false,
                        isOutdated: false,
                        diffHunk: `@@ -${comment.line},1 +${comment.line},1 @@\n ${comment.body.slice(0, 40)}`,
                        comments: [
                            {
                                id: `${id}-c0`,
                                databaseId,
                                author: account?.login ?? "octocat",
                                authorAvatarUrl: account?.avatarUrl ?? null,
                                body: comment.body,
                                createdAt: new Date().toISOString(),
                                url: `https://github.com/${input.repository}/pull/${input.number}#discussion_r${databaseId}`,
                                reactionGroups: [],
                            },
                        ],
                    } satisfies ReviewThread;
                });
                if (created.length > 0) {
                    threadsByPullRequest.set(key, [...(threadsByPullRequest.get(key) ?? []), ...created]);
                }
            });
        },
        replyToReviewThread(token, threadId, body) {
            return respond("replyToReviewThread", (): ReviewThreadComment => {
                authenticate(token);

                for (const [key, threads] of threadsByPullRequest) {
                    const index = threads.findIndex((thread) => thread.id === threadId);

                    if (index < 0) {
                        continue;
                    }

                    const account = accounts.get(token);
                    const keyMatch = /^[^:]+:(.+)#(\d+)$/.exec(key);
                    const repository = keyMatch?.[1] ?? "acme/api";
                    const pullNumber = keyMatch?.[2] ?? "1";
                    const reply: ReviewThreadComment = {
                        id: `reply-${++replyCounter}`,
                        databaseId: replyCounter,
                        author: account?.login ?? "octocat",
                        authorAvatarUrl: account?.avatarUrl ?? null,
                        body,
                        createdAt: new Date().toISOString(),
                        url: `https://github.com/${repository}/pull/${pullNumber}#discussion_r${replyCounter}`,
                        reactionGroups: [],
                    };
                    const updated = {
                        ...threads[index]!,
                        comments: [...threads[index]!.comments, reply],
                    };
                    const next = [...threads];
                    next[index] = updated;
                    threadsByPullRequest.set(key, next);
                    return reply;
                }

                throw new EasyReviewError("not-found", "That review thread no longer exists.");
            });
        },
        setReviewThreadResolved(token, threadId, resolved) {
            return respond("setReviewThreadResolved", () => {
                authenticate(token);

                for (const [key, threads] of threadsByPullRequest) {
                    const index = threads.findIndex((thread) => thread.id === threadId);
                    if (index < 0) {
                        continue;
                    }

                    const next = [...threads];
                    next[index] = { ...threads[index]!, isResolved: resolved };
                    threadsByPullRequest.set(key, next);
                    return;
                }

                throw new EasyReviewError("not-found", "That review thread no longer exists.");
            });
        },
        setPullRequestDraft(token, repository, number, isDraft) {
            return respond("setPullRequestDraft", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                patchPullRequest(token, repository, number, { isDraft });
            });
        },
        setPullRequestFileViewed(token, repository, number, path, viewed) {
            return respond("setPullRequestFileViewed", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                const key = filesKey(token, repository, number);
                const paths = viewedFilesByPullRequest.get(key) ?? new Set<string>();
                if (viewed) {
                    paths.add(path);
                } else {
                    paths.delete(path);
                }
                viewedFilesByPullRequest.set(key, paths);
            });
        },
        setPullRequestLabels(token, repository, number, labels) {
            return respond("setPullRequestLabels", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const next: Array<Label> = labels.map((name) => {
                    const existing = pullRequest.labels.find((label) => label.name === name);
                    return existing ?? { name, color: "ededed" };
                });
                patchPullRequest(token, repository, number, { labels: next });
            });
        },
        setPullRequestAssignees(token, repository, number, assignees) {
            return respond("setPullRequestAssignees", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                patchPullRequest(token, repository, number, { assignees: [...assignees] });
            });
        },
        requestReviewers(token, repository, number, reviewers) {
            return respond("requestReviewers", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const next = new Set(pullRequest.reviewRequests);
                for (const login of reviewers) {
                    next.add(login);
                }
                patchPullRequest(token, repository, number, { reviewRequests: [...next] });
            });
        },
        removeReviewers(token, repository, number, reviewers) {
            return respond("removeReviewers", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const drop = new Set(reviewers);
                patchPullRequest(token, repository, number, {
                    reviewRequests: pullRequest.reviewRequests.filter((login) => !drop.has(login)),
                });
            });
        },
        reRequestReview(token, repository, number, reviewers) {
            return respond("reRequestReview", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const drop = new Set(reviewers);
                const without = pullRequest.reviewRequests.filter((login) => !drop.has(login));
                patchPullRequest(token, repository, number, {
                    reviewRequests: [...without, ...reviewers],
                });
            });
        },
        dismissReview(token, repository, number, reviewId, _message: string) {
            return respond("dismissReview", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const reviewers = pullRequest.reviewers.map((reviewer) =>
                    reviewer.reviewId === reviewId ? { ...reviewer, state: "dismissed" as const } : reviewer,
                );
                if (!reviewers.some((reviewer) => reviewer.reviewId === reviewId)) {
                    throw new EasyReviewError("not-found", "That review could not be found.");
                }
                patchPullRequest(token, repository, number, {
                    reviewers,
                    reviewDecision: null,
                });
            });
        },
        mergePullRequest(token, repository, number, method: MergeMethod, options?: MergePullRequestOptions) {
            return respond("mergePullRequest", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                if (pullRequest.mergeable === "conflicting") {
                    throw new EasyReviewError("unknown", "This pull request has merge conflicts.");
                }
                patchPullRequest(token, repository, number, {
                    state: "merged",
                    isDraft: false,
                    mergedAt: new Date().toISOString(),
                    reviewRequests: [],
                });
            });
        },
        closePullRequest(token, repository, number) {
            return respond("closePullRequest", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                patchPullRequest(token, repository, number, {
                    state: "closed",
                    isDraft: false,
                    reviewRequests: [],
                });
            });
        },
        uploadPullRequestMedia(token, input) {
            return respond("uploadPullRequestMedia", () => {
                authenticate(token);
                requirePullRequest(token, input.repository, input.number);
                const [owner = "", name = ""] = input.repository.split("/");
                const safe = input.fileName.replaceAll(/[^\w.-]+/g, "_") || "upload.bin";
                const url = `https://github.com/${owner}/${name}/blob/upload-sha/${safe}?raw=true`;
                const isVideo = input.contentType.startsWith("video/");
                return {
                    url,
                    markdown: isVideo ? `<video src="${url}" controls></video>` : `![${safe}](${url})`,
                };
            });
        },
        resolveUserAttachment(token, _repository, attachmentUrl) {
            return respond("resolveUserAttachment", () => {
                authenticate(token);
                if (!attachmentUrl.includes("user-attachments/assets/")) {
                    return null;
                }
                return {
                    kind: "image" as const,
                    src: `https://private-user-images.githubusercontent.com/1/${attachmentUrl.split("/").pop()}.png?jwt=test`,
                    name: "fixture.png",
                };
            });
        },
        resolveRepoBlobMedia(token, mediaUrl) {
            return respond("resolveRepoBlobMedia", () => {
                authenticate(token);
                if (!mediaUrl.includes("/blob/") || !mediaUrl.includes("raw=true")) {
                    return null;
                }
                const name = mediaUrl.split("/").pop()?.split("?")[0] ?? "upload.bin";
                const lower = name.toLowerCase();
                const kind =
                    lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov")
                        ? ("video" as const)
                        : ("image" as const);
                return {
                    kind,
                    src: `https://raw.githubusercontent.com/acme/api/sha/${name}?token=test`,
                    name,
                };
            });
        },
        updatePullRequestBody(token, repository, number, body) {
            return respond("updatePullRequestBody", () => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                patchPullRequest(token, repository, number, { body });
            });
        },
        applySuggestions(token, input) {
            return respond("applySuggestions", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, input.repository, input.number);
                requireOpen(pullRequest);
                if (pullRequest.headSha !== input.headSha) {
                    throw new EasyReviewError("unknown", "This suggestion is outdated.");
                }
                if (input.changes.length === 0) {
                    throw new EasyReviewError("unknown", "No suggestions to apply.");
                }
                const key = filesKey(token, input.repository, input.number);
                const stored = filesByPullRequest.get(key) ?? [];
                const byPath = new Map<string, Array<(typeof input.changes)[number]>>();
                for (const change of input.changes) {
                    const list = byPath.get(change.path) ?? [];
                    list.push(change);
                    byPath.set(change.path, list);
                }
                filesByPullRequest.set(
                    key,
                    stored.map((file) => {
                        const changes = byPath.get(file.path);
                        if (!changes || !file.after) {
                            return file;
                        }
                        const text = new TextDecoder().decode(file.after);
                        const next = applySuggestionsToFile(text, changes);
                        return { ...file, after: new TextEncoder().encode(next) };
                    }),
                );
                patchPullRequest(token, input.repository, input.number, {
                    headSha: `${pullRequest.headSha}-applied`,
                });
            });
        },
        updatePullRequest(token, repository, number, input) {
            return respond("updatePullRequest", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                const patch: { title?: string; baseRefName?: string } = {};
                if (input.title !== undefined) {
                    patch.title = input.title;
                }
                if (input.base !== undefined) {
                    patch.baseRefName = input.base;
                }
                patchPullRequest(token, repository, number, patch);
            });
        },
        listRepositoryBranches(token, repository) {
            return respond("listRepositoryBranches", () => {
                authenticate(token);
                const branches = new Set<string>(["main", "dev", "develop"]);
                for (const pullRequest of pullRequestsByToken.get(token) ?? []) {
                    if (pullRequest.repository === repository) {
                        branches.add(pullRequest.baseRefName);
                        branches.add(pullRequest.headRefName);
                    }
                }
                return [...branches].sort((a, b) => a.localeCompare(b));
            });
        },
        createIssueReaction(token, repository, number, content) {
            return respond("createIssueReaction", () => {
                const viewer = authenticate(token);
                requirePullRequest(token, repository, number);
                const key = filesKey(token, repository, number);
                const rows = issueReactions.get(key) ?? [];
                const existing = rows.find((row) => row.user === viewer.login && row.content === content);
                if (existing) {
                    return existing.id;
                }
                const id = ++reactionCounter;
                issueReactions.set(key, [...rows, { id, content, user: viewer.login }]);
                syncIssueReactions(token, repository, number);
                return id;
            });
        },
        deleteIssueReaction(token, repository, number, reactionId) {
            return respond("deleteIssueReaction", () => {
                authenticate(token);
                const key = filesKey(token, repository, number);
                const rows = (issueReactions.get(key) ?? []).filter((row) => row.id !== reactionId);
                issueReactions.set(key, rows);
                syncIssueReactions(token, repository, number);
            });
        },
        findIssueReactionId(token, repository, number, content, viewerLogin) {
            return respond("findIssueReactionId", () => {
                authenticate(token);
                const rows = issueReactions.get(filesKey(token, repository, number)) ?? [];
                return rows.find((row) => row.content === content && row.user === viewerLogin)?.id ?? null;
            });
        },
        createIssueCommentReaction(token, repository, commentId, content) {
            return respond("createIssueCommentReaction", () => {
                const viewer = authenticate(token);
                const rows = commentReactions.get(commentId) ?? [];
                const existing = rows.find((row) => row.user === viewer.login && row.content === content);
                if (existing) {
                    return existing.id;
                }
                const id = ++reactionCounter;
                commentReactions.set(commentId, [...rows, { id, content, user: viewer.login }]);
                for (const [key, items] of timelineByPullRequest) {
                    if (!key.startsWith(`${token}:${repository}#`)) {
                        continue;
                    }
                    if (items.some((item) => item.kind === "comment" && item.databaseId === commentId)) {
                        syncCommentReactions(token, repository, Number(key.split("#")[1]), commentId);
                    }
                }
                return id;
            });
        },
        deleteIssueCommentReaction(token, repository, commentId, reactionId) {
            return respond("deleteIssueCommentReaction", () => {
                authenticate(token);
                commentReactions.set(
                    commentId,
                    (commentReactions.get(commentId) ?? []).filter((row) => row.id !== reactionId),
                );
                for (const [key, items] of timelineByPullRequest) {
                    if (!key.startsWith(`${token}:${repository}#`)) {
                        continue;
                    }
                    if (items.some((item) => item.kind === "comment" && item.databaseId === commentId)) {
                        syncCommentReactions(token, repository, Number(key.split("#")[1]), commentId);
                    }
                }
            });
        },
        findIssueCommentReactionId(token, _repository, commentId, content, viewerLogin) {
            return respond("findIssueCommentReactionId", () => {
                authenticate(token);
                const rows = commentReactions.get(commentId) ?? [];
                return rows.find((row) => row.content === content && row.user === viewerLogin)?.id ?? null;
            });
        },
        createReviewCommentReaction(token, _repository, commentId, content) {
            return respond("createReviewCommentReaction", () => {
                const viewer = authenticate(token);
                const rows = reviewCommentReactions.get(commentId) ?? [];
                const existing = rows.find((row) => row.content === content && row.user === viewer.login);
                if (existing) {
                    return existing.id;
                }
                const id = ++reactionCounter;
                reviewCommentReactions.set(commentId, [...rows, { id, content, user: viewer.login }]);
                syncReviewCommentReactions(commentId, viewer.login);
                return id;
            });
        },
        deleteReviewCommentReaction(token, _repository, commentId, reactionId) {
            return respond("deleteReviewCommentReaction", () => {
                const viewer = authenticate(token);
                reviewCommentReactions.set(
                    commentId,
                    (reviewCommentReactions.get(commentId) ?? []).filter((row) => row.id !== reactionId),
                );
                syncReviewCommentReactions(commentId, viewer.login);
            });
        },
        findReviewCommentReactionId(token, _repository, commentId, content, viewerLogin) {
            return respond("findReviewCommentReactionId", () => {
                authenticate(token);
                const rows = reviewCommentReactions.get(commentId) ?? [];
                return rows.find((row) => row.content === content && row.user === viewerLogin)?.id ?? null;
            });
        },
    };
}
