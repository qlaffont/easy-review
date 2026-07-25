import type { GithubClient, GithubViewer, GetFileDiffOptions } from "#/lib/session/ports.ts";
import type {
    FileDiff,
    Label,
    MergeMethod,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    Repository,
    ReviewEvent,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import { buildFileDiff } from "#/lib/session/build-file-diff.ts";
import { stubForPath } from "#/lib/session/diff-policy.ts";
import { EasyReviewError, unauthorized } from "#/lib/session/errors.ts";

export type FakeGithub = GithubClient & {
    /** Register a token GitHub will accept, together with the account behind it. */
    addAccount(token: string, viewer?: Partial<GithubViewer>): GithubViewer;
    /** Make a repository visible to a token. */
    addRepository(token: string, nameWithOwner: string, repository?: Partial<Repository>): Repository;
    /** Add a pull request to a repository. */
    addPullRequest(token: string, pullRequest: PullRequestInput): PullRequestDetail;
    /** Seed the files (and optional before/after text) for a pull request. */
    setPullRequestFiles(token: string, repository: string, number: number, files: Array<FakeFileInput>): void;
    /** Repository sets asked for, one entry per `listPullRequests` call. */
    pullRequestQueries: Array<ReadonlyArray<string>>;
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
    /** Move the head SHA so draft invalidation can be exercised. */
    setPullRequestHead(token: string, repository: string, number: number, headSha: string): void;
    /** Revoke a token so the next call with it fails as unauthorized. */
    revokeAccount(token: string): void;
    /** Make the next call fail, whatever the token. */
    failNextWith(error: EasyReviewError): void;
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
        reviewers: input.reviewers ?? [],
        checks: input.checks ?? "none",
        additions: input.additions ?? 0,
        deletions: input.deletions ?? 0,
        changedFiles: input.changedFiles ?? 0,
        commentCount: input.commentCount ?? 0,
        body: input.body ?? "",
        headSha: input.headSha ?? `sha-head-${input.number}`,
        baseSha: input.baseSha ?? `sha-base-${input.number}`,
        labels: input.labels ?? [],
        assignees: input.assignees ?? [],
        checkRuns: input.checkRuns ?? [],
        mergeable: input.mergeable ?? "mergeable",
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
    const threadsByPullRequest = new Map<string, Array<ReviewThread>>();
    const pullRequestQueries: Array<ReadonlyArray<string>> = [];
    const fileDiffQueries: Array<string> = [];
    const submittedReviews: FakeGithub["submittedReviews"] = [];
    const calls: Array<string> = [];
    let forcedError: EasyReviewError | null = null;
    let gate: Promise<void> | null = null;
    let replyCounter = 0;

    function authenticate(token: string): GithubViewer {
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
                `${repository}#${number} does not exist, or this token cannot see it.`,
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

    return {
        calls,
        pullRequestQueries,
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
            return entry;
        },
        addPullRequest(token, input) {
            const pullRequest = buildPullRequest(input);
            pullRequestsByToken.set(token, [...(pullRequestsByToken.get(token) ?? []), pullRequest]);
            return pullRequest;
        },
        addReviewThread(token, repository, number, thread) {
            const key = filesKey(token, repository, number);
            threadsByPullRequest.set(key, [...(threadsByPullRequest.get(key) ?? []), thread]);
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

            for (const key of filesByPullRequest.keys()) {
                if (key.startsWith(`${token}:`)) {
                    filesByPullRequest.delete(key);
                }
            }
        },
        failNextWith(error) {
            forcedError = error;
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
        listPullRequests(token, repositories) {
            pullRequestQueries.push(repositories);

            return respond("listPullRequests", () => {
                authenticate(token);
                const wanted = new Set(repositories);
                return (pullRequestsByToken.get(token) ?? [])
                    .filter((pullRequest) => wanted.has(pullRequest.repository))
                    .map(toSummary);
            });
        },
        getPullRequest(token, repository, number) {
            return respond("getPullRequest", () => {
                authenticate(token);
                return requirePullRequest(token, repository, number);
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
        getPullRequestFileDiff(token, repository, number, path, options?: GetFileDiffOptions) {
            fileDiffQueries.push(path);

            return respond("getPullRequestFileDiff", (): FileDiff => {
                authenticate(token);
                requirePullRequest(token, repository, number);
                const force = options?.force === true;
                const pathStub = stubForPath(path);

                if (pathStub === "binary" || (pathStub && !force)) {
                    return { path, lines: [], truncated: false, stub: pathStub };
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
        submitReview(token, input) {
            return respond("submitReview", () => {
                authenticate(token);
                requirePullRequest(token, input.repository, input.number);
                submittedReviews.push({
                    repository: input.repository,
                    number: input.number,
                    headSha: input.headSha,
                    event: input.event,
                    body: input.body,
                    comments: input.comments.map((comment) => ({ ...comment })),
                });
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

                    const reply: ReviewThreadComment = {
                        id: `reply-${++replyCounter}`,
                        author: accounts.get(token)?.login ?? "octocat",
                        body,
                        createdAt: new Date().toISOString(),
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
        setPullRequestDraft(token, repository, number, isDraft) {
            return respond("setPullRequestDraft", () => {
                authenticate(token);
                const pullRequest = requirePullRequest(token, repository, number);
                requireOpen(pullRequest);
                patchPullRequest(token, repository, number, { isDraft });
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
        mergePullRequest(token, repository, number, _method: MergeMethod) {
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
    };
}
