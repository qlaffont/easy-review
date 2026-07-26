import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type {
    CheckRun,
    CheckState,
    FileChangeStatus,
    MergeableState,
    MergeMethod,
    PullRequestComment,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    PullRequestTimelineItem,
    Repository,
    RepositoryLabel,
    RepositoryUser,
    ReviewDecision,
    ReviewEvent,
    ReviewState,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import { buildFileDiff } from "#/lib/session/build-file-diff.ts";
import { HUGE_FILE_BYTES, stubForPath } from "#/lib/session/diff-policy.ts";
import { EasyReviewError } from "#/lib/session/errors.ts";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_URL = "https://api.github.com";
const REPOSITORY_PAGE_SIZE = 100;
/** Stops a runaway account with thousands of repos from burning the rate limit in one go. */
const REPOSITORY_PAGE_LIMIT = 10;
/** Repositories asked for in a single aliased GraphQL document. */
const INBOX_BATCH_SIZE = 10;
const OPEN_PULL_REQUESTS_PER_REPOSITORY = 30;
const MERGED_PULL_REQUESTS_PER_REPOSITORY = 10;
/** GraphQL caps `pullRequest.files` at 100 per page. */
const FILES_PAGE_SIZE = 100;
const FILES_PAGE_LIMIT = 20;
const TIMELINE_PAGE_SIZE = 100;
const TIMELINE_PAGE_LIMIT = 5;

type GraphqlResponse<TData> = {
    data?: TData;
    errors?: Array<{ type?: string; message: string }>;
};

function rateLimitedError(retryAt: string | undefined): EasyReviewError {
    const when = retryAt ? ` Try again after ${new Date(retryAt).toLocaleTimeString()}.` : "";
    return new EasyReviewError("rate-limited", `GitHub rate limit reached for this token.${when}`, { retryAt });
}

function resetHeaderToIso(headers: Headers): string | undefined {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
        return new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
    }

    const reset = headers.get("x-ratelimit-reset");
    if (reset) {
        return new Date(Number(reset) * 1000).toISOString();
    }

    return undefined;
}

function errorForStatus(response: Response): EasyReviewError {
    if (response.status === 401) {
        return new EasyReviewError(
            "unauthorized",
            "GitHub rejected this token. Check that it is a valid fine-grained token and has not expired.",
        );
    }

    if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        if (remaining === "0" || response.headers.get("retry-after")) {
            return rateLimitedError(resetHeaderToIso(response.headers));
        }

        return new EasyReviewError(
            "forbidden",
            "This token is missing a permission GitHub requires for that action. Review the permissions below and regenerate it.",
        );
    }

    if (response.status === 404) {
        return new EasyReviewError("not-found", "GitHub could not find that resource, or this token cannot see it.");
    }

    return new EasyReviewError("unknown", `GitHub replied with an unexpected status (${response.status}).`);
}

/**
 * Errors that condemn the whole response rather than one field of it. A batched Inbox query can
 * survive a repository it may not read; it cannot survive a token GitHub has stopped serving.
 */
function isFatalGraphqlError(error: { type?: string }): boolean {
    return error.type === "RATE_LIMITED" || error.type === "UNAUTHORIZED";
}

function errorForGraphqlErrors(errors: NonNullable<GraphqlResponse<unknown>["errors"]>): EasyReviewError {
    const first = errors[0];
    const type = first?.type;
    const message = first?.message ?? "GitHub rejected the query.";

    if (type === "RATE_LIMITED") {
        return rateLimitedError(undefined);
    }

    if (type === "FORBIDDEN") {
        return new EasyReviewError("forbidden", message);
    }

    if (type === "NOT_FOUND") {
        return new EasyReviewError("not-found", message);
    }

    if (type === "UNAUTHORIZED") {
        return new EasyReviewError("unauthorized", message);
    }

    return new EasyReviewError("unknown", message);
}

export function createGithubHttpClient(fetchImpl: typeof fetch = globalThis.fetch): GithubClient {
    /**
     * `keepPartial` is for queries that ask about many things at once: GitHub answers the fields it
     * can and reports the rest as errors, and one unreadable repository should not empty the Inbox.
     */
    async function graphql<TData>(
        token: string,
        query: string,
        variables?: Record<string, unknown>,
        { keepPartial = false }: { keepPartial?: boolean } = {},
    ): Promise<TData> {
        let response: Response;

        try {
            response = await fetchImpl(GRAPHQL_URL, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
            });
        } catch (cause) {
            throw new EasyReviewError("network", "Could not reach GitHub. Check your connection and try again.", {
                cause,
            });
        }

        if (!response.ok) {
            throw errorForStatus(response);
        }

        const payload = (await response.json()) as GraphqlResponse<TData>;

        if (payload.errors?.length) {
            const fatal = payload.errors.filter(isFatalGraphqlError);

            if (fatal.length) {
                throw errorForGraphqlErrors(fatal);
            }

            if (!keepPartial || !payload.data) {
                throw errorForGraphqlErrors(payload.errors);
            }
        }

        if (!payload.data) {
            throw new EasyReviewError("unknown", "GitHub returned an empty response.");
        }

        return payload.data;
    }

    return {
        async getViewer(token) {
            const data = await graphql<{ viewer: GithubViewer }>(
                token,
                `
                    query EasyReviewViewer {
                        viewer {
                            login
                            name
                            avatarUrl
                        }
                    }
                `,
            );

            return data.viewer;
        },

        async listRepositories(token) {
            /**
             * Prefer REST `/user/repos` over GraphQL `viewer.repositories`. Fine-grained PATs
             * scoped to an organization see those org repos on REST, but GraphQL often returns
             * only the user's personal repositories — which is exactly the empty-Inbox failure
             * mode we hit with org resource-owner tokens.
             */
            const repositories: Array<Repository> = [];
            let path: string | null =
                `/user/repos?per_page=${REPOSITORY_PAGE_SIZE}&sort=pushed&affiliation=owner,collaborator,organization_member`;

            for (let page = 0; page < REPOSITORY_PAGE_LIMIT && path; page++) {
                const response = await rest(token, path);

                if (!response.ok) {
                    throw errorForStatus(response);
                }

                const nodes = (await response.json()) as Array<RestRepositoryNode>;

                for (const node of nodes) {
                    repositories.push({
                        nameWithOwner: node.full_name,
                        owner: node.owner.login,
                        name: node.name,
                        isPrivate: node.private,
                        isArchived: node.archived,
                        pushedAt: node.pushed_at,
                    });
                }

                path = nextRestPath(response.headers.get("link"));
            }

            return repositories;
        },

        async listPullRequests(token, repositories) {
            const batches: Array<Array<string>> = [];

            for (let index = 0; index < repositories.length; index += INBOX_BATCH_SIZE) {
                batches.push(repositories.slice(index, index + INBOX_BATCH_SIZE));
            }

            const pages = await Promise.all(
                batches.map((batch) =>
                    graphql<PullRequestsQuery>(token, buildInboxQuery(batch), undefined, { keepPartial: true }),
                ),
            );

            return pages.flatMap((page) =>
                Object.values(page).flatMap((repository) =>
                    repository === null
                        ? []
                        : [
                              ...repository.open.nodes.map(toPullRequestSummary),
                              ...repository.merged.nodes.map(toPullRequestSummary),
                          ],
                ),
            );
        },

        async getPullRequest(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            // Fine-grained PATs cannot read CheckRun nodes (no Checks permission exists for
            // them), so GitHub returns FORBIDDEN on those context slots while still returning
            // the PR and any StatusContext rows. Keep the partial payload.
            const data = await graphql<PullRequestQuery>(
                token,
                PULL_REQUEST_QUERY,
                { owner, name, number },
                { keepPartial: true },
            );
            const node = data.repository?.pullRequest;

            if (!node) {
                throw new EasyReviewError(
                    "not-found",
                    `${repository}#${number} does not exist, or this token cannot see it.`,
                );
            }

            const repo = data.repository!;
            const detail = toPullRequestDetail(node, {
                mergeCommitAllowed: repo.mergeCommitAllowed,
                squashMergeAllowed: repo.squashMergeAllowed,
                rebaseMergeAllowed: repo.rebaseMergeAllowed,
                viewerDefaultMergeMethod: repo.viewerDefaultMergeMethod,
            });
            if (detail.requiredApprovingReviewCount != null) {
                return detail;
            }

            // Classic `branchProtectionRule` is often null when the requirement comes from
            // repository rulesets — resolve the effective rules for the base branch.
            const fromRulesets = await requiredApprovingReviewsFromBranchRules(token, owner, name, node.baseRefName);

            return {
                ...detail,
                requiredApprovingReviewCount: fromRulesets,
            };
        },

        async listRepositoryAssignees(token, repository) {
            const [owner = "", name = ""] = repository.split("/");
            const users: Array<RepositoryUser> = [];
            let path: string | null = `/repos/${owner}/${name}/assignees?per_page=100`;

            for (let page = 0; page < 10 && path; page++) {
                const response = await rest(token, path);

                if (!response.ok) {
                    throw errorForStatus(response);
                }

                const nodes = (await response.json()) as Array<RestUserNode>;
                for (const node of nodes) {
                    users.push({
                        login: node.login,
                        name: node.name ?? null,
                        avatarUrl: node.avatar_url ?? null,
                    });
                }

                path = nextRestPath(response.headers.get("link"));
            }

            return users;
        },

        async listRepositoryLabels(token, repository) {
            const [owner = "", name = ""] = repository.split("/");
            const labels: Array<RepositoryLabel> = [];
            let path: string | null = `/repos/${owner}/${name}/labels?per_page=100`;

            for (let page = 0; page < 10 && path; page++) {
                const response = await rest(token, path);

                if (!response.ok) {
                    throw errorForStatus(response);
                }

                const nodes = (await response.json()) as Array<RestLabelNode>;
                for (const node of nodes) {
                    labels.push({
                        name: node.name,
                        color: node.color,
                        description: node.description,
                    });
                }

                path = nextRestPath(response.headers.get("link"));
            }

            return labels;
        },

        async listPullRequestFiles(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            const files: Array<PullRequestFile> = [];
            let cursor: string | null = null;

            for (let page = 0; page < FILES_PAGE_LIMIT; page++) {
                const data: PullRequestFilesQuery = await graphql<PullRequestFilesQuery>(
                    token,
                    PULL_REQUEST_FILES_QUERY,
                    { owner, name, number, pageSize: FILES_PAGE_SIZE, cursor },
                );
                const connection = data.repository?.pullRequest?.files;

                if (!connection) {
                    throw new EasyReviewError(
                        "not-found",
                        `${repository}#${number} does not exist, or this token cannot see it.`,
                    );
                }

                for (const node of connection.nodes) {
                    files.push(toPullRequestFile(node));
                }

                if (!connection.pageInfo.hasNextPage) {
                    break;
                }

                if (page === FILES_PAGE_LIMIT - 1) {
                    throw new EasyReviewError(
                        "unknown",
                        `${repository}#${number} has more than ${FILES_PAGE_LIMIT * FILES_PAGE_SIZE} changed files. Easy Review stops there so the file list stays usable.`,
                    );
                }

                cursor = connection.pageInfo.endCursor;
            }

            return files;
        },

        async getPullRequestFileDiff(token, repository, number, path, options) {
            const force = options?.force === true;
            const pathStub = stubForPath(path);

            // Binary path stubs never expand. Generated / huge-from-path can with force.
            if (pathStub === "binary" || (pathStub && !force)) {
                return { path, lines: [], truncated: false, stub: pathStub };
            }

            const [owner = "", name = ""] = repository.split("/");
            const meta = await graphql<PullRequestRefsQuery>(token, PULL_REQUEST_REFS_QUERY, {
                owner,
                name,
                number,
            });
            const pullRequest = meta.repository?.pullRequest;

            if (!pullRequest) {
                throw new EasyReviewError(
                    "not-found",
                    `${repository}#${number} does not exist, or this token cannot see it.`,
                );
            }

            const beforePath = options?.previousPath || path;
            const [before, after] = await Promise.all([
                readBlob(token, owner, name, beforePath, pullRequest.baseRefOid, force),
                readBlob(token, owner, name, path, pullRequest.headRefOid, force),
            ]);

            if (before?.stub || after?.stub) {
                return { path, lines: [], truncated: false, stub: before?.stub ?? after?.stub ?? "huge" };
            }

            return buildFileDiff({ path, before: before?.bytes ?? null, after: after?.bytes ?? null }, { force });
        },

        async listReviewThreads(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            const threads: Array<ReviewThread> = [];
            let cursor: string | null = null;

            for (let page = 0; page < 20; page++) {
                const data: ReviewThreadsQuery = await graphql<ReviewThreadsQuery>(token, REVIEW_THREADS_QUERY, {
                    owner,
                    name,
                    number,
                    cursor,
                });
                const connection = data.repository?.pullRequest?.reviewThreads;

                if (!connection) {
                    throw new EasyReviewError(
                        "not-found",
                        `${repository}#${number} does not exist, or this token cannot see it.`,
                    );
                }

                for (const node of connection.nodes) {
                    threads.push(toReviewThread(node));
                }

                if (!connection.pageInfo.hasNextPage) {
                    break;
                }

                cursor = connection.pageInfo.endCursor;
            }

            return threads;
        },

        async listPullRequestComments(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            const comments: Array<PullRequestComment> = [];
            let path: string | null = `/repos/${owner}/${name}/issues/${number}/comments?per_page=100`;

            for (let page = 0; page < 10 && path; page++) {
                const response = await rest(token, path);

                if (!response.ok) {
                    throw errorForStatus(response);
                }

                const nodes = (await response.json()) as Array<RestIssueCommentNode>;
                for (const node of nodes) {
                    comments.push(toPullRequestComment(node));
                }

                path = nextRestPath(response.headers.get("link"));
            }

            return comments;
        },

        async listPullRequestTimeline(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            const items: Array<PullRequestTimelineItem> = [];
            let cursor: string | null = null;

            for (let page = 0; page < TIMELINE_PAGE_LIMIT; page++) {
                const data: PullRequestTimelineQuery = await graphql(token, PULL_REQUEST_TIMELINE_QUERY, {
                    owner,
                    name,
                    number,
                    pageSize: TIMELINE_PAGE_SIZE,
                    cursor,
                });
                const connection = data.repository?.pullRequest?.timelineItems;
                if (!connection) {
                    throw new EasyReviewError(
                        "not-found",
                        `${repository}#${number} does not exist, or this token cannot see it.`,
                    );
                }

                for (const node of connection.nodes) {
                    const item = toTimelineItem(node);
                    if (item) {
                        items.push(item);
                    }
                }

                if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
                    break;
                }

                cursor = connection.pageInfo.endCursor;
            }

            return items;
        },

        async addPullRequestComment(token, repository, number, body) {
            const [owner = "", name = ""] = repository.split("/");
            const node = (await restJson(token, "POST", `/repos/${owner}/${name}/issues/${number}/comments`, {
                body,
            })) as RestIssueCommentNode;

            return toPullRequestComment(node);
        },

        async submitReview(token, input) {
            const [owner = "", name = ""] = input.repository.split("/");
            const event = toGithubReviewEvent(input.event);

            await restJson(token, "POST", `/repos/${owner}/${name}/pulls/${input.number}/reviews`, {
                commit_id: input.headSha,
                event,
                body: input.body,
                comments: input.comments.map((comment) => ({
                    path: comment.path,
                    line: comment.line,
                    side: comment.side,
                    body: comment.body,
                })),
            });
        },

        async replyToReviewThread(token, threadId, body) {
            const data = await graphql<{
                addPullRequestReviewThreadReply: { comment: ReviewThreadCommentNode };
            }>(token, REPLY_TO_THREAD_MUTATION, { threadId, body });

            return toThreadComment(data.addPullRequestReviewThreadReply.comment);
        },

        async setPullRequestDraft(token, repository, number, isDraft) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PATCH", `/repos/${owner}/${name}/pulls/${number}`, { draft: isDraft });
        },

        async setPullRequestLabels(token, repository, number, labels) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PUT", `/repos/${owner}/${name}/issues/${number}/labels`, {
                labels: [...labels],
            });
        },

        async setPullRequestAssignees(token, repository, number, assignees) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PATCH", `/repos/${owner}/${name}/issues/${number}`, {
                assignees: [...assignees],
            });
        },

        async requestReviewers(token, repository, number, reviewers) {
            if (reviewers.length === 0) {
                return;
            }

            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "POST", `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`, {
                reviewers: [...reviewers],
            });
        },

        async removeReviewers(token, repository, number, reviewers) {
            if (reviewers.length === 0) {
                return;
            }

            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "DELETE", `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`, {
                reviewers: [...reviewers],
            });
        },

        async reRequestReview(token, repository, number, reviewers) {
            if (reviewers.length === 0) {
                return;
            }

            const [owner = "", name = ""] = repository.split("/");
            const path = `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`;
            const body = { reviewers: [...reviewers] };

            await restJson(token, "DELETE", path, body);

            try {
                await restJson(token, "POST", path, body);
            } catch (error) {
                // Best-effort restore: DELETE already cleared the requests; put them back
                // before surfacing the failure so the PR is not left without reviewers.
                try {
                    await restJson(token, "POST", path, body);
                } catch {
                    // Preserve the original POST failure.
                }

                throw error;
            }
        },

        async mergePullRequest(token, repository, number, method: MergeMethod) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PUT", `/repos/${owner}/${name}/pulls/${number}/merge`, {
                merge_method: method,
            });
        },

        async closePullRequest(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PATCH", `/repos/${owner}/${name}/pulls/${number}`, { state: "closed" });
        },
    };

    async function restJson(token: string, method: string, path: string, body: unknown): Promise<unknown> {
        let response: Response;

        try {
            response = await fetchImpl(`${REST_URL}${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: "application/vnd.github+json",
                    "content-type": "application/json",
                },
                body: JSON.stringify(body),
            });
        } catch (cause) {
            throw new EasyReviewError("network", "Could not reach GitHub. Check your connection and try again.", {
                cause,
            });
        }

        if (!response.ok) {
            throw errorForStatus(response);
        }

        if (response.status === 204) {
            return null;
        }

        return response.json();
    }

    async function rest(token: string, path: string): Promise<Response> {
        try {
            return await fetchImpl(`${REST_URL}${path}`, {
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: "application/vnd.github+json",
                },
            });
        } catch (cause) {
            throw new EasyReviewError("network", "Could not reach GitHub. Check your connection and try again.", {
                cause,
            });
        }
    }

    /** Effective pull-request rules for a branch (rulesets + classic protection). */
    async function requiredApprovingReviewsFromBranchRules(
        token: string,
        owner: string,
        name: string,
        branch: string,
    ): Promise<number | null> {
        const response = await rest(token, `/repos/${owner}/${name}/rules/branches/${encodeURIComponent(branch)}`);

        if (!response.ok) {
            return null;
        }

        const rules = (await response.json()) as Array<BranchRuleNode>;
        let required: number | null = null;

        for (const rule of rules) {
            if (rule.type !== "pull_request") {
                continue;
            }

            const count = rule.parameters?.required_approving_review_count;
            if (typeof count === "number" && count > 0) {
                required = required == null ? count : Math.max(required, count);
            }
        }

        return required;
    }

    /**
     * Raw file bytes at one commit. `null` means the path does not exist there (added or removed
     * files). Directories and Git LFS pointers are treated as missing content for diff purposes.
     * When GitHub omits inline content (blobs over ~1 MB), we either stub as huge or follow
     * `download_url` if the reviewer forced the load.
     */
    async function readBlob(
        token: string,
        owner: string,
        name: string,
        path: string,
        ref: string,
        force: boolean,
    ): Promise<{ bytes: Uint8Array; stub?: undefined } | { bytes?: undefined; stub: "huge" } | null> {
        const response = await rest(
            token,
            `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
        );

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw errorForStatus(response);
        }

        const payload = (await response.json()) as {
            type?: string;
            encoding?: string;
            content?: string;
            size?: number;
            download_url?: string | null;
        };

        if (payload.type !== "file") {
            return null;
        }

        const size = payload.size ?? 0;

        if (!force && size > HUGE_FILE_BYTES) {
            return { stub: "huge" };
        }

        if (typeof payload.content === "string" && payload.encoding === "base64") {
            return {
                bytes: Uint8Array.from(atob(payload.content.replace(/\n/g, "")), (char) => char.charCodeAt(0)),
            };
        }

        if (typeof payload.content === "string") {
            return { bytes: new TextEncoder().encode(payload.content) };
        }

        if (!payload.download_url) {
            return size > HUGE_FILE_BYTES ? { stub: "huge" } : null;
        }

        if (!force && size > HUGE_FILE_BYTES) {
            return { stub: "huge" };
        }

        const download = await fetchImpl(payload.download_url, {
            headers: { authorization: `Bearer ${token}` },
        });

        if (!download.ok) {
            throw errorForStatus(download);
        }

        return { bytes: new Uint8Array(await download.arrayBuffer()) };
    }
}

/** Encode each path segment so nested paths survive the Contents API. */
function encodePath(path: string): string {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

type PullRequestNode = {
    number: number;
    title: string;
    url: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    createdAt: string;
    updatedAt: string;
    mergedAt: string | null;
    headRefName: string;
    baseRefName: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
    author: { login: string; avatarUrl: string | null } | null;
    repository: { nameWithOwner: string };
    comments: { totalCount: number };
    reviewRequests: {
        nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }>;
    };
    latestReviews: { nodes: Array<{ author: { login: string } | null; state: string }> };
    commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
};

type RepositoryPullRequests = {
    open: { nodes: Array<PullRequestNode> };
    merged: { nodes: Array<PullRequestNode> };
} | null;

type PullRequestsQuery = Record<string, RepositoryPullRequests>;

function toCheckState(rollup: string | undefined): CheckState {
    switch (rollup) {
        case "SUCCESS":
            return "success";
        case "FAILURE":
        case "ERROR":
            return "failure";
        case "PENDING":
        case "EXPECTED":
            return "pending";
        default:
            return "none";
    }
}

function toReviewDecision(decision: PullRequestNode["reviewDecision"]): ReviewDecision {
    switch (decision) {
        case "APPROVED":
            return "approved";
        case "CHANGES_REQUESTED":
            return "changes-requested";
        case "REVIEW_REQUIRED":
            return "review-required";
        default:
            return null;
    }
}

function toReviewState(state: string): ReviewState {
    switch (state) {
        case "APPROVED":
            return "approved";
        case "CHANGES_REQUESTED":
            return "changes-requested";
        case "COMMENTED":
            return "commented";
        case "DISMISSED":
            return "dismissed";
        default:
            return "pending";
    }
}

function toPullRequestSummary(node: PullRequestNode): PullRequestSummary {
    const repository = node.repository.nameWithOwner;

    return {
        key: `${repository}#${node.number}`,
        repository,
        number: node.number,
        title: node.title,
        url: node.url,
        author: node.author?.login ?? "ghost",
        authorAvatarUrl: node.author?.avatarUrl ?? null,
        state: node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : "open",
        isDraft: node.isDraft,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        mergedAt: node.mergedAt,
        headRefName: node.headRefName,
        baseRefName: node.baseRefName,
        reviewDecision: toReviewDecision(node.reviewDecision),
        reviewRequests: node.reviewRequests.nodes.flatMap((request) => {
            const reviewer = request.requestedReviewer;
            const name = reviewer?.login ?? reviewer?.name;
            return name ? [name] : [];
        }),
        reviewers: node.latestReviews.nodes.flatMap((review) =>
            review.author ? [{ login: review.author.login, state: toReviewState(review.state) }] : [],
        ),
        checks: toCheckState(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        commentCount: node.comments.totalCount,
    };
}

/** One document, one alias pair per repository: the whole batch costs a single round trip. */
function buildInboxQuery(repositories: ReadonlyArray<string>): string {
    const selections = repositories.map((nameWithOwner, index) => {
        const [owner = "", name = ""] = nameWithOwner.split("/");

        return `
            repo${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
                open: pullRequests(
                    states: [OPEN]
                    first: ${OPEN_PULL_REQUESTS_PER_REPOSITORY}
                    orderBy: { field: UPDATED_AT, direction: DESC }
                ) { nodes { ...InboxPullRequest } }
                merged: pullRequests(
                    states: [MERGED]
                    first: ${MERGED_PULL_REQUESTS_PER_REPOSITORY}
                    orderBy: { field: UPDATED_AT, direction: DESC }
                ) { nodes { ...InboxPullRequest } }
            }
        `;
    });

    return `
        query EasyReviewInbox {
            ${selections.join("\n")}
        }

        fragment InboxPullRequest on PullRequest {
            ${PULL_REQUEST_FIELDS}
        }
    `;
}

/** The fields behind `PullRequestSummary`, shared by the Inbox batch and the overview query. */
const PULL_REQUEST_FIELDS = `
    number
    title
    url
    state
    isDraft
    createdAt
    updatedAt
    mergedAt
    headRefName
    baseRefName
    additions
    deletions
    changedFiles
    reviewDecision
    author {
        login
        avatarUrl
    }
    repository {
        nameWithOwner
    }
    comments {
        totalCount
    }
    reviewRequests(first: 10) {
        nodes {
            requestedReviewer {
                ... on User {
                    login
                }
                ... on Team {
                    name
                }
            }
        }
    }
    latestReviews(first: 20) {
        nodes {
            author {
                login
            }
            state
        }
    }
    commits(last: 1) {
        nodes {
            commit {
                statusCheckRollup {
                    state
                }
            }
        }
    }
`;

type CheckContextNode =
    | {
          __typename: "CheckRun";
          name: string;
          status: string;
          conclusion: string | null;
          detailsUrl: string | null;
      }
    | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null }
    | null;

/**
 * The overview asks for the same fields as an Inbox row plus the ones only a whole page has
 * room for. GraphQL merges the two `commits` selections, so the head SHA and the individual
 * check runs arrive alongside the rollup the row already used.
 */
type PullRequestDetailNode = Omit<PullRequestNode, "commits"> & {
    body: string;
    baseRefOid: string;
    headRefOid: string;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    baseRef: {
        branchProtectionRule: {
            requiresApprovingReviews: boolean;
            requiredApprovingReviewCount: number;
        } | null;
    } | null;
    labels: { nodes: Array<{ name: string; color: string }> } | null;
    assignees: { nodes: Array<{ login: string }> };
    commits: {
        totalCount: number;
        nodes: Array<{
            commit: {
                oid: string;
                statusCheckRollup: { state: string; contexts: { nodes: Array<CheckContextNode> } } | null;
            };
        }>;
    };
};

type RepositoryMergeSettings = {
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    viewerDefaultMergeMethod: "MERGE" | "SQUASH" | "REBASE" | null;
};

type PullRequestQuery = {
    repository: (RepositoryMergeSettings & { pullRequest: PullRequestDetailNode | null }) | null;
};

type PullRequestFileNode = {
    path: string;
    additions: number;
    deletions: number;
    changeType: "ADDED" | "DELETED" | "MODIFIED" | "RENAMED" | "COPIED" | "CHANGED";
};

type PullRequestFilesQuery = {
    repository: {
        pullRequest: {
            files: {
                nodes: Array<PullRequestFileNode>;
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
            } | null;
        } | null;
    } | null;
};

type PullRequestRefsQuery = {
    repository: { pullRequest: { baseRefOid: string; headRefOid: string } | null } | null;
};

const PULL_REQUEST_QUERY = `
    query EasyReviewPullRequest($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            mergeCommitAllowed
            squashMergeAllowed
            rebaseMergeAllowed
            viewerDefaultMergeMethod
            pullRequest(number: $number) {
                ${PULL_REQUEST_FIELDS}
                body
                baseRefOid
                headRefOid
                mergeable
                baseRef {
                    branchProtectionRule {
                        requiresApprovingReviews
                        requiredApprovingReviewCount
                    }
                }
                labels(first: 20) {
                    nodes {
                        name
                        color
                    }
                }
                assignees(first: 10) {
                    nodes {
                        login
                    }
                }
                commits(last: 1) {
                    totalCount
                    nodes {
                        commit {
                            oid
                            statusCheckRollup {
                                contexts(first: 50) {
                                    nodes {
                                        __typename
                                        ... on CheckRun {
                                            name
                                            status
                                            conclusion
                                            detailsUrl
                                        }
                                        ... on StatusContext {
                                            context
                                            state
                                            targetUrl
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

const PULL_REQUEST_FILES_QUERY = `
    query EasyReviewPullRequestFiles(
        $owner: String!
        $name: String!
        $number: Int!
        $pageSize: Int!
        $cursor: String
    ) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                files(first: $pageSize, after: $cursor) {
                    nodes {
                        path
                        additions
                        deletions
                        changeType
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        }
    }
`;

const TIMELINE_ITEM_TYPES = [
    "ISSUE_COMMENT",
    "PULL_REQUEST_COMMIT",
    "ASSIGNED_EVENT",
    "UNASSIGNED_EVENT",
    "RENAMED_TITLE_EVENT",
    "LABELED_EVENT",
    "UNLABELED_EVENT",
    "REVIEW_REQUESTED_EVENT",
    "REVIEW_REQUEST_REMOVED_EVENT",
    "READY_FOR_REVIEW_EVENT",
    "CONVERT_TO_DRAFT_EVENT",
    "CLOSED_EVENT",
    "REOPENED_EVENT",
    "MERGED_EVENT",
    "PULL_REQUEST_REVIEW",
    "HEAD_REF_FORCE_PUSHED_EVENT",
    "BASE_REF_CHANGED_EVENT",
] as const;

const PULL_REQUEST_TIMELINE_QUERY = `
    query EasyReviewPullRequestTimeline(
        $owner: String!
        $name: String!
        $number: Int!
        $pageSize: Int!
        $cursor: String
    ) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                timelineItems(
                    first: $pageSize
                    after: $cursor
                    itemTypes: [${TIMELINE_ITEM_TYPES.join(", ")}]
                ) {
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        __typename
                        ... on IssueComment {
                            id
                            body
                            createdAt
                            url
                            author {
                                login
                                avatarUrl
                            }
                        }
                        ... on PullRequestCommit {
                            id
                            commit {
                                oid
                                abbreviatedOid
                                messageHeadline
                                committedDate
                                url
                                author {
                                    user {
                                        login
                                        avatarUrl
                                    }
                                    name
                                }
                                statusCheckRollup {
                                    state
                                }
                            }
                        }
                        ... on AssignedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            assignee {
                                ... on User {
                                    login
                                }
                            }
                        }
                        ... on UnassignedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            assignee {
                                ... on User {
                                    login
                                }
                            }
                        }
                        ... on RenamedTitleEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            previousTitle
                            currentTitle
                        }
                        ... on LabeledEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            label {
                                name
                                color
                            }
                        }
                        ... on UnlabeledEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            label {
                                name
                                color
                            }
                        }
                        ... on ReviewRequestedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            requestedReviewer {
                                ... on User {
                                    login
                                }
                                ... on Team {
                                    name
                                }
                            }
                        }
                        ... on ReviewRequestRemovedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            requestedReviewer {
                                ... on User {
                                    login
                                }
                                ... on Team {
                                    name
                                }
                            }
                        }
                        ... on ReadyForReviewEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on ConvertToDraftEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on ClosedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on ReopenedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on MergedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on PullRequestReview {
                            id
                            body
                            createdAt
                            url
                            state
                            author {
                                login
                                avatarUrl
                            }
                        }
                        ... on HeadRefForcePushedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                        }
                        ... on BaseRefChangedEvent {
                            id
                            createdAt
                            actor {
                                login
                                avatarUrl
                            }
                            previousRefName
                            currentRefName
                        }
                    }
                }
            }
        }
    }
`;

type TimelineActorNode = { login: string; avatarUrl: string | null } | null;

type TimelineNode =
    | {
          __typename: "IssueComment";
          id: string;
          body: string;
          createdAt: string;
          url: string;
          author: TimelineActorNode;
      }
    | {
          __typename: "PullRequestCommit";
          id: string;
          commit: {
              oid: string;
              abbreviatedOid: string;
              messageHeadline: string;
              committedDate: string;
              url: string;
              author: { user: TimelineActorNode; name: string | null } | null;
              statusCheckRollup: { state: string } | null;
          };
      }
    | {
          __typename: "AssignedEvent" | "UnassignedEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
          assignee: { login: string } | null;
      }
    | {
          __typename: "RenamedTitleEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
          previousTitle: string;
          currentTitle: string;
      }
    | {
          __typename: "LabeledEvent" | "UnlabeledEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
          label: { name: string; color: string };
      }
    | {
          __typename: "ReviewRequestedEvent" | "ReviewRequestRemovedEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
          requestedReviewer: { login?: string; name?: string } | null;
      }
    | {
          __typename:
              | "ReadyForReviewEvent"
              | "ConvertToDraftEvent"
              | "ClosedEvent"
              | "ReopenedEvent"
              | "MergedEvent"
              | "HeadRefForcePushedEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
      }
    | {
          __typename: "PullRequestReview";
          id: string;
          body: string;
          createdAt: string;
          url: string;
          state: string;
          author: TimelineActorNode;
      }
    | {
          __typename: "BaseRefChangedEvent";
          id: string;
          createdAt: string;
          actor: TimelineActorNode;
          previousRefName: string;
          currentRefName: string;
      }
    | null;

type PullRequestTimelineQuery = {
    repository: {
        pullRequest: {
            timelineItems: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<TimelineNode>;
            };
        } | null;
    } | null;
};

function toTimelineActor(actor: TimelineActorNode): { login: string; avatarUrl: string | null } {
    return {
        login: actor?.login ?? "ghost",
        avatarUrl: actor?.avatarUrl ?? null,
    };
}

function toTimelineReviewer(reviewer: { login?: string; name?: string } | null): string {
    return reviewer?.login ?? reviewer?.name ?? "someone";
}

function toTimelineItem(node: TimelineNode): PullRequestTimelineItem | null {
    if (!node) {
        return null;
    }

    switch (node.__typename) {
        case "IssueComment":
            return {
                kind: "comment",
                id: node.id,
                author: node.author?.login ?? "ghost",
                authorAvatarUrl: node.author?.avatarUrl ?? null,
                body: node.body,
                createdAt: node.createdAt,
                url: node.url,
            };
        case "PullRequestCommit": {
            const commit = node.commit;
            const authorUser = commit.author?.user;
            return {
                kind: "commit",
                id: node.id,
                createdAt: commit.committedDate,
                author: {
                    login: authorUser?.login ?? commit.author?.name ?? "ghost",
                    avatarUrl: authorUser?.avatarUrl ?? null,
                },
                messageHeadline: commit.messageHeadline,
                oid: commit.oid,
                abbreviatedOid: commit.abbreviatedOid,
                url: commit.url,
                checkState: toCheckState(commit.statusCheckRollup?.state),
            };
        }
        case "AssignedEvent":
            return {
                kind: "assigned",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                assignee: node.assignee?.login ?? "someone",
            };
        case "UnassignedEvent":
            return {
                kind: "unassigned",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                assignee: node.assignee?.login ?? "someone",
            };
        case "RenamedTitleEvent":
            return {
                kind: "renamed-title",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                previousTitle: node.previousTitle,
                currentTitle: node.currentTitle,
            };
        case "LabeledEvent":
            return {
                kind: "labeled",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                label: node.label,
            };
        case "UnlabeledEvent":
            return {
                kind: "unlabeled",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                label: node.label,
            };
        case "ReviewRequestedEvent":
            return {
                kind: "review-requested",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                reviewer: toTimelineReviewer(node.requestedReviewer),
            };
        case "ReviewRequestRemovedEvent":
            return {
                kind: "review-request-removed",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                reviewer: toTimelineReviewer(node.requestedReviewer),
            };
        case "ReadyForReviewEvent":
            return {
                kind: "ready-for-review",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "ConvertToDraftEvent":
            return {
                kind: "convert-to-draft",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "ClosedEvent":
            return {
                kind: "closed",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "ReopenedEvent":
            return {
                kind: "reopened",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "MergedEvent":
            return {
                kind: "merged",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "PullRequestReview":
            return {
                kind: "review",
                id: node.id,
                createdAt: node.createdAt,
                author: toTimelineActor(node.author),
                state: toReviewState(node.state),
                body: node.body,
                url: node.url,
            };
        case "HeadRefForcePushedEvent":
            return {
                kind: "head-ref-force-pushed",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
            };
        case "BaseRefChangedEvent":
            return {
                kind: "base-ref-changed",
                id: node.id,
                createdAt: node.createdAt,
                actor: toTimelineActor(node.actor),
                previousRefName: node.previousRefName,
                currentRefName: node.currentRefName,
            };
        default:
            return null;
    }
}

const PULL_REQUEST_REFS_QUERY = `
    query EasyReviewPullRequestRefs($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                baseRefOid
                headRefOid
            }
        }
    }
`;

function toFileChangeStatus(changeType: PullRequestFileNode["changeType"]): FileChangeStatus {
    switch (changeType) {
        case "ADDED":
            return "added";
        case "DELETED":
            return "removed";
        case "RENAMED":
            return "renamed";
        default:
            return "modified";
    }
}

function toPullRequestFile(node: PullRequestFileNode): PullRequestFile {
    return {
        path: node.path,
        previousPath: null,
        status: toFileChangeStatus(node.changeType),
        additions: node.additions,
        deletions: node.deletions,
        stub: stubForPath(node.path),
    };
}

/** A run GitHub has not finished is pending whatever it ends up concluding. */
function toCheckRunState(status: string, conclusion: string | null): CheckState {
    if (status !== "COMPLETED") {
        return "pending";
    }

    switch (conclusion) {
        case "SUCCESS":
        case "NEUTRAL":
        case "SKIPPED":
            return "success";
        case "FAILURE":
        case "TIMED_OUT":
        case "CANCELLED":
        case "ACTION_REQUIRED":
        case "STARTUP_FAILURE":
            return "failure";
        default:
            return "none";
    }
}

function toCheckRun(context: NonNullable<CheckContextNode>): CheckRun {
    if (context.__typename === "CheckRun") {
        return {
            name: context.name,
            state: toCheckRunState(context.status, context.conclusion),
            url: context.detailsUrl,
        };
    }

    return { name: context.context, state: toCheckState(context.state), url: context.targetUrl };
}

function toMergeableState(mergeable: PullRequestDetailNode["mergeable"]): MergeableState {
    switch (mergeable) {
        case "MERGEABLE":
            return "mergeable";
        case "CONFLICTING":
            return "conflicting";
        default:
            return "unknown";
    }
}

function toRequiredApprovingReviewCount(node: PullRequestDetailNode): number | null {
    const rule = node.baseRef?.branchProtectionRule;
    if (!rule?.requiresApprovingReviews) {
        return null;
    }

    return rule.requiredApprovingReviewCount;
}

function toAllowedMergeMethods(settings: RepositoryMergeSettings): Array<MergeMethod> {
    // Same order as GitHub's merge menu.
    const methods: Array<MergeMethod> = [];
    if (settings.mergeCommitAllowed) {
        methods.push("merge");
    }
    if (settings.squashMergeAllowed) {
        methods.push("squash");
    }
    if (settings.rebaseMergeAllowed) {
        methods.push("rebase");
    }
    return methods;
}

function toDefaultMergeMethod(settings: RepositoryMergeSettings, allowed: Array<MergeMethod>): MergeMethod | null {
    const preferred =
        settings.viewerDefaultMergeMethod === "MERGE"
            ? "merge"
            : settings.viewerDefaultMergeMethod === "SQUASH"
              ? "squash"
              : settings.viewerDefaultMergeMethod === "REBASE"
                ? "rebase"
                : null;

    if (preferred && allowed.includes(preferred)) {
        return preferred;
    }

    return allowed[0] ?? null;
}

function toPullRequestDetail(node: PullRequestDetailNode, settings: RepositoryMergeSettings): PullRequestDetail {
    const commit = node.commits.nodes[0]?.commit;
    const allowedMergeMethods = toAllowedMergeMethods(settings);

    return {
        ...toPullRequestSummary(node),
        body: node.body,
        headSha: node.headRefOid || commit?.oid || "",
        baseSha: node.baseRefOid,
        labels: node.labels?.nodes ?? [],
        assignees: node.assignees.nodes.map((assignee) => assignee.login),
        checkRuns: (commit?.statusCheckRollup?.contexts.nodes ?? [])
            .filter((context): context is NonNullable<CheckContextNode> => context !== null)
            .map(toCheckRun),
        mergeable: toMergeableState(node.mergeable),
        requiredApprovingReviewCount: toRequiredApprovingReviewCount(node),
        allowedMergeMethods,
        defaultMergeMethod: toDefaultMergeMethod(settings, allowedMergeMethods),
        commitCount: node.commits.totalCount,
    };
}

type RestRepositoryNode = {
    full_name: string;
    name: string;
    private: boolean;
    archived: boolean;
    pushed_at: string | null;
    owner: { login: string };
};

type RestUserNode = {
    login: string;
    name?: string | null;
    avatar_url: string | null;
};

type BranchRuleNode = {
    type: string;
    parameters?: {
        required_approving_review_count?: number;
    } | null;
};

type RestLabelNode = {
    name: string;
    color: string;
    description: string | null;
};

type RestIssueCommentNode = {
    id: number;
    node_id: string;
    body: string;
    created_at: string;
    html_url: string;
    user: { login: string; avatar_url: string | null } | null;
};

function toPullRequestComment(node: RestIssueCommentNode): PullRequestComment {
    return {
        id: node.node_id || String(node.id),
        author: node.user?.login ?? "ghost",
        authorAvatarUrl: node.user?.avatar_url ?? null,
        body: node.body,
        createdAt: node.created_at,
        url: node.html_url,
    };
}

/** Follow GitHub's Link header to the next REST page; returns a path relative to `REST_URL`. */
function nextRestPath(linkHeader: string | null): string | null {
    if (!linkHeader) {
        return null;
    }

    const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
    if (!match?.[1]) {
        return null;
    }

    const url = new URL(match[1]);
    return `${url.pathname}${url.search}`;
}

type ReviewThreadCommentNode = {
    id: string;
    body: string;
    createdAt: string;
    author: { login: string } | null;
};

type ReviewThreadNode = {
    id: string;
    isResolved: boolean;
    path: string;
    line: number | null;
    diffSide: "LEFT" | "RIGHT" | null;
    comments: { nodes: Array<ReviewThreadCommentNode> };
};

type ReviewThreadsQuery = {
    repository: {
        pullRequest: {
            reviewThreads: {
                nodes: Array<ReviewThreadNode>;
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
            } | null;
        } | null;
    } | null;
};

const REVIEW_THREADS_QUERY = `
    query EasyReviewReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                reviewThreads(first: 50, after: $cursor) {
                    nodes {
                        id
                        isResolved
                        path
                        line
                        diffSide
                        comments(first: 50) {
                            nodes {
                                id
                                body
                                createdAt
                                author {
                                    login
                                }
                            }
                        }
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        }
    }
`;

const REPLY_TO_THREAD_MUTATION = `
    mutation EasyReviewReplyToThread($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
            comment {
                id
                body
                createdAt
                author {
                    login
                }
            }
        }
    }
`;

function toGithubReviewEvent(event: ReviewEvent): "COMMENT" | "APPROVE" | "REQUEST_CHANGES" {
    switch (event) {
        case "approve":
            return "APPROVE";
        case "request-changes":
            return "REQUEST_CHANGES";
        default:
            return "COMMENT";
    }
}

function toThreadComment(node: ReviewThreadCommentNode): ReviewThreadComment {
    return {
        id: node.id,
        author: node.author?.login ?? "ghost",
        body: node.body,
        createdAt: node.createdAt,
    };
}

function toReviewThread(node: ReviewThreadNode): ReviewThread {
    return {
        id: node.id,
        path: node.path,
        line: node.line,
        side: node.diffSide,
        isResolved: node.isResolved,
        comments: node.comments.nodes.map(toThreadComment),
    };
}
