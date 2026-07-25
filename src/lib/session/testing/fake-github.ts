import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type { PullRequestDetail, PullRequestSummary, Repository } from "#/lib/session/types.ts";

import { EasyReviewError, unauthorized } from "#/lib/session/errors.ts";

export type FakeGithub = GithubClient & {
    /** Register a token GitHub will accept, together with the account behind it. */
    addAccount(token: string, viewer?: Partial<GithubViewer>): GithubViewer;
    /** Make a repository visible to a token. */
    addRepository(token: string, nameWithOwner: string, repository?: Partial<Repository>): Repository;
    /** Add a pull request to a repository. */
    addPullRequest(token: string, pullRequest: PullRequestInput): PullRequestDetail;
    /** Repository sets asked for, one entry per `listPullRequests` call. */
    pullRequestQueries: Array<ReadonlyArray<string>>;
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
        headSha: input.headSha ?? `sha-${input.number}`,
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

export function createFakeGithub(): FakeGithub {
    const accounts = new Map<string, GithubViewer>();
    const repositoriesByToken = new Map<string, Array<Repository>>();
    const pullRequestsByToken = new Map<string, Array<PullRequestDetail>>();
    const pullRequestQueries: Array<ReadonlyArray<string>> = [];
    const calls: Array<string> = [];
    let forcedError: EasyReviewError | null = null;
    let gate: Promise<void> | null = null;

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

    return {
        calls,
        pullRequestQueries,
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
        revokeAccount(token) {
            accounts.delete(token);
            repositoriesByToken.delete(token);
            pullRequestsByToken.delete(token);
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
            });
        },
    };
}
