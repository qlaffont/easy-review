import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type {
    CheckRun,
    CheckState,
    FileChangeStatus,
    MergeableState,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    Repository,
    ReviewDecision,
    ReviewState,
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
            const repositories: Array<Repository> = [];
            let cursor: string | null = null;

            for (let page = 0; page < REPOSITORY_PAGE_LIMIT; page++) {
                const data: RepositoriesQuery = await graphql<RepositoriesQuery>(token, REPOSITORIES_QUERY, {
                    pageSize: REPOSITORY_PAGE_SIZE,
                    cursor,
                });
                const { nodes, pageInfo } = data.viewer.repositories;

                for (const node of nodes) {
                    repositories.push({
                        nameWithOwner: node.nameWithOwner,
                        owner: node.owner.login,
                        name: node.name,
                        isPrivate: node.isPrivate,
                        isArchived: node.isArchived,
                        pushedAt: node.pushedAt,
                    });
                }

                if (!pageInfo.hasNextPage) {
                    break;
                }

                cursor = pageInfo.endCursor;
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
            const data = await graphql<PullRequestQuery>(token, PULL_REQUEST_QUERY, { owner, name, number });
            const node = data.repository?.pullRequest;

            if (!node) {
                throw new EasyReviewError(
                    "not-found",
                    `${repository}#${number} does not exist, or this token cannot see it.`,
                );
            }

            return toPullRequestDetail(node);
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
    };

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
    | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

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
    labels: { nodes: Array<{ name: string; color: string }> } | null;
    assignees: { nodes: Array<{ login: string }> };
    commits: {
        nodes: Array<{
            commit: {
                oid: string;
                statusCheckRollup: { state: string; contexts: { nodes: Array<CheckContextNode> } } | null;
            };
        }>;
    };
};

type PullRequestQuery = { repository: { pullRequest: PullRequestDetailNode | null } | null };

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
            pullRequest(number: $number) {
                ${PULL_REQUEST_FIELDS}
                body
                baseRefOid
                headRefOid
                mergeable
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

function toCheckRun(context: CheckContextNode): CheckRun {
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

function toPullRequestDetail(node: PullRequestDetailNode): PullRequestDetail {
    const commit = node.commits.nodes[0]?.commit;

    return {
        ...toPullRequestSummary(node),
        body: node.body,
        headSha: node.headRefOid || commit?.oid || "",
        baseSha: node.baseRefOid,
        labels: node.labels?.nodes ?? [],
        assignees: node.assignees.nodes.map((assignee) => assignee.login),
        checkRuns: (commit?.statusCheckRollup?.contexts.nodes ?? []).map(toCheckRun),
        mergeable: toMergeableState(node.mergeable),
    };
}

type RepositoriesQuery = {
    viewer: {
        repositories: {
            nodes: Array<{
                name: string;
                nameWithOwner: string;
                isPrivate: boolean;
                isArchived: boolean;
                pushedAt: string | null;
                owner: { login: string };
            }>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
    };
};

const REPOSITORIES_QUERY = `
    query EasyReviewRepositories($pageSize: Int!, $cursor: String) {
        viewer {
            repositories(
                first: $pageSize
                after: $cursor
                affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
                orderBy: { field: PUSHED_AT, direction: DESC }
            ) {
                nodes {
                    name
                    nameWithOwner
                    isPrivate
                    isArchived
                    pushedAt
                    owner {
                        login
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    }
`;
