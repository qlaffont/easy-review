import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type { PullRequestSummary, Repository } from "#/lib/session/types.ts";

import { EasyReviewError, unauthorized } from "#/lib/session/errors.ts";

export type FakeGithub = GithubClient & {
    /** Register a token GitHub will accept, together with the account behind it. */
    addAccount(token: string, viewer?: Partial<GithubViewer>): GithubViewer;
    /** Make a repository visible to a token. */
    addRepository(token: string, nameWithOwner: string, repository?: Partial<Repository>): Repository;
    /** Add a pull request to a repository. */
    addPullRequest(token: string, pullRequest: PullRequestInput): PullRequestSummary;
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

export type PullRequestInput = Partial<PullRequestSummary> & { repository: string; number: number };

function buildPullRequest(input: PullRequestInput): PullRequestSummary {
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
    };
}

export function createFakeGithub(): FakeGithub {
    const accounts = new Map<string, GithubViewer>();
    const repositoriesByToken = new Map<string, Array<Repository>>();
    const pullRequestsByToken = new Map<string, Array<PullRequestSummary>>();
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
                return (pullRequestsByToken.get(token) ?? []).filter((pullRequest) =>
                    wanted.has(pullRequest.repository),
                );
            });
        },
    };
}
