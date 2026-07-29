import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type {
    CheckState,
    CommitSignature,
    ContentEdit,
    ContentEditor,
    FileChangeStatus,
    MergeableState,
    MergeMethod,
    MergeStateStatus,
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
    ReviewDecision,
    ReviewEvent,
    ReviewState,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

import { mediaKindForNameAndType, mediaMarkdown, sanitizeMediaFileName } from "#/lib/composer-media.ts";
import {
    isGithubUserAttachmentUrl,
    mediaKindFromPath,
    parseGithubAttachmentMarkdownHtml,
    parseGithubRepoBlobRawUrl,
} from "#/lib/github-attachment.ts";
import { applySuggestionsToFile, type SuggestionChange } from "#/lib/session/apply-suggestion.ts";
import { buildFileDiff } from "#/lib/session/build-file-diff.ts";
import { mapCheckRuns, type CheckContextInput } from "#/lib/session/check-runs.ts";
import { HUGE_FILE_BYTES, stubForPath } from "#/lib/session/diff-policy.ts";
import { EasyReviewError } from "#/lib/session/errors.ts";
import {
    comparePullRequestsByUpdatedAtDesc,
    matchesPullRequestSearchQuery,
    parseGitHubPullRequestUrl,
    parsePullRequestNumberQuery,
} from "#/lib/session/pull-request-search.ts";
import { matchesRelatedRefs } from "#/lib/session/related-pull-requests.ts";

const DEFAULT_GRAPHQL_URL = "https://api.github.com/graphql";
const DEFAULT_REST_URL = "https://api.github.com";

/**
 * Credential passed from the session layer when auth is an HTTP-only OAuth cookie.
 * The GitHub HTTP client omits `Authorization`; the same-origin proxy attaches the token.
 */
export const GITHUB_SESSION_CREDENTIAL = "session";

export type GithubHttpClientOptions = {
    /** Base URL for REST (`/repos/...`). Defaults to `https://api.github.com`. */
    restBaseUrl?: string;
    /** GraphQL endpoint. Defaults to `https://api.github.com/graphql`. */
    graphqlUrl?: string;
    /** Forward cookies (required for the OAuth proxy). */
    credentials?: RequestCredentials;
};

const REPOSITORY_PAGE_SIZE = 100;
/** Stops a runaway account with thousands of repos from burning the rate limit in one go. */
const REPOSITORY_PAGE_LIMIT = 10;
/** Repositories asked for in a single aliased GraphQL document. */
const INBOX_BATCH_SIZE = 10;
const OPEN_PULL_REQUESTS_PER_REPOSITORY = 30;
const MERGED_PULL_REQUESTS_PER_REPOSITORY = 10;
/** Related scans batch a few repos per search query (query length + rate limit). */
const RELATED_SEARCH_REPO_BATCH_SIZE = 10;
const RELATED_SEARCH_RESULT_CAP = 25;
/** GraphQL caps `pullRequest.files` at 100 per page. */
const FILES_PAGE_SIZE = 100;
const FILES_PAGE_LIMIT = 20;
const TIMELINE_PAGE_SIZE = 100;
const TIMELINE_PAGE_LIMIT = 5;
const COMMITS_PAGE_SIZE = 100;
const COMMITS_PAGE_LIMIT = 5;

type GraphqlResponse<TData> = {
    data?: TData;
    errors?: Array<{ type?: string; message: string }>;
};

function rateLimitedError(retryAt: string | undefined): EasyReviewError {
    const when = retryAt ? ` Try again after ${new Date(retryAt).toLocaleTimeString()}.` : "";
    return new EasyReviewError("rate-limited", `GitHub rate limit reached for this session.${when}`, { retryAt });
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
            "GitHub rejected this session. Sign in again, or check that the OAuth app still has access.",
        );
    }

    if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        if (remaining === "0" || response.headers.get("retry-after")) {
            return rateLimitedError(resetHeaderToIso(response.headers));
        }

        return new EasyReviewError("forbidden", FORBIDDEN_PERMISSION_MESSAGE);
    }

    if (response.status === 404) {
        return new EasyReviewError("not-found", "GitHub could not find that resource, or this session cannot see it.");
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
        return new EasyReviewError("unknown", "GitHub is temporarily unreachable. Try again in a moment.");
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

const FORBIDDEN_PERMISSION_MESSAGE =
    "This GitHub session is missing a permission required for that action. Check the GitHub App permissions (and installation), then reconnect.";

const MEDIA_UPLOAD_PERMISSION_MESSAGE =
    "Media upload needs Contents: Read and write on your GitHub App. Update Permissions & events, reinstall if needed, then reconnect.";

/** Rewrite GitHub copy that still says “personal access token” / “integration” for OAuth sessions. */
function humanizeGithubMessage(message: string): string {
    if (/personal access token|accessible by integration/i.test(message)) {
        return FORBIDDEN_PERMISSION_MESSAGE;
    }

    return message;
}

function errorForGraphqlErrors(errors: NonNullable<GraphqlResponse<unknown>["errors"]>): EasyReviewError {
    const first = errors[0];
    const type = first?.type;
    const message = humanizeGithubMessage(first?.message ?? "GitHub rejected the query.");

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

function authorizationHeaders(token: string): HeadersInit {
    if (token === GITHUB_SESSION_CREDENTIAL) {
        return {};
    }

    return { authorization: `Bearer ${token}` };
}

export function createGithubHttpClient(
    fetchImpl: typeof fetch = globalThis.fetch,
    options: GithubHttpClientOptions = {},
): GithubClient {
    const REST_URL = options.restBaseUrl ?? DEFAULT_REST_URL;
    const GRAPHQL_URL = options.graphqlUrl ?? DEFAULT_GRAPHQL_URL;
    const credentials = options.credentials;
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
                    ...authorizationHeaders(token),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
                credentials,
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
             * GitHub App user tokens only see repos covered by an installation. List via
             * `/user/installations` → `/user/installations/{id}/repositories` (not `/user/repos`),
             * otherwise org repos never appear even when the user is an org member.
             */
            const byName = new Map<string, Repository>();
            const installationIds = await listInstallationIds(token, rest);

            await Promise.all(
                installationIds.map(async (installationId) => {
                    let path: string | null =
                        `/user/installations/${installationId}/repositories?per_page=${REPOSITORY_PAGE_SIZE}`;

                    for (let page = 0; page < REPOSITORY_PAGE_LIMIT && path; page++) {
                        const response = await rest(token, path);

                        if (!response.ok) {
                            throw errorForStatus(response);
                        }

                        const payload = (await response.json()) as { repositories?: Array<RestRepositoryNode> };
                        for (const node of payload.repositories ?? []) {
                            byName.set(node.full_name, {
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
                }),
            );

            return [...byName.values()].sort((a, b) => {
                const aTime = a.pushedAt ? Date.parse(a.pushedAt) : 0;
                const bTime = b.pushedAt ? Date.parse(b.pushedAt) : 0;
                return bTime - aTime;
            });
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

        async searchPullRequests(token, input) {
            const first = Math.min(Math.max(input.limit ?? 25, 1), 50);
            const linkQuery = parseGitHubPullRequestUrl(input.query);

            // Pasted GitHub PR URL → look up that exact owner/repo#number.
            if (linkQuery) {
                const data = await graphql<LookupPullRequestsByNumberQuery>(
                    token,
                    buildLookupPullRequestsByNumberQuery([linkQuery.repository], linkQuery.number),
                    undefined,
                    { keepPartial: true },
                );
                const node = Object.values(data)[0]?.pullRequest;
                return node ? [toSearchPullRequestSummary(node)] : [];
            }

            if (input.repositories.length === 0) {
                return [];
            }

            const numberQuery = parsePullRequestNumberQuery(input.query);

            // Bare `#196` / `196`: look up that number in each selected repo (lean query).
            // Title search cannot find PRs by number, and full getPullRequest is too heavy here.
            if (numberQuery != null) {
                const batches: Array<Array<string>> = [];
                for (let index = 0; index < input.repositories.length; index += INBOX_BATCH_SIZE) {
                    batches.push(input.repositories.slice(index, index + INBOX_BATCH_SIZE));
                }

                const pages = await Promise.all(
                    batches.map((batch) =>
                        graphql<LookupPullRequestsByNumberQuery>(
                            token,
                            buildLookupPullRequestsByNumberQuery(batch, numberQuery),
                            undefined,
                            { keepPartial: true },
                        ),
                    ),
                );

                const matched: Array<PullRequestSummary> = [];
                for (const page of pages) {
                    for (const repository of Object.values(page)) {
                        const node = repository?.pullRequest;
                        if (!node) {
                            continue;
                        }
                        matched.push(toSearchPullRequestSummary(node));
                    }
                }

                return matched.sort(comparePullRequestsByUpdatedAtDesc).slice(0, first);
            }

            const batches = buildPullRequestSearchQueryBatches(input.query, input.repositories);
            if (batches.length === 0) {
                return [];
            }

            const pages = await Promise.all(
                batches.map((query) =>
                    graphql<SearchPullRequestsQuery>(token, SEARCH_PULL_REQUESTS_QUERY, { query, first }),
                ),
            );

            const wanted = new Set(input.repositories);
            const byKey = new Map<string, PullRequestSummary>();

            for (const page of pages) {
                for (const node of page.search.nodes) {
                    if (node == null || typeof node !== "object" || !("number" in node) || !("repository" in node)) {
                        continue;
                    }
                    const summary = toSearchPullRequestSummary(node as SearchPullRequestNode);
                    if (
                        !wanted.has(summary.repository) ||
                        byKey.has(summary.key) ||
                        !matchesPullRequestSearchQuery(summary, input.query)
                    ) {
                        continue;
                    }
                    byKey.set(summary.key, summary);
                }
            }

            return [...byKey.values()].sort(comparePullRequestsByUpdatedAtDesc).slice(0, first);
        },

        async listRelatedPullRequests(token, input) {
            if (input.repositories.length === 0) {
                return [];
            }

            const batches = buildRelatedSearchQueryBatches(input);
            if (batches.length === 0) {
                return [];
            }

            const pages = await Promise.all(
                batches.map(async (query) => {
                    try {
                        return await graphql<SearchPullRequestsQuery>(token, SEARCH_PULL_REQUESTS_QUERY, {
                            query,
                            first: RELATED_SEARCH_RESULT_CAP,
                        });
                    } catch (error) {
                        return { error };
                    }
                }),
            );

            const wanted = new Set(input.repositories);
            const byKey = new Map<string, PullRequestSummary>();
            let lastError: unknown = null;
            let succeeded = 0;

            for (const page of pages) {
                if ("error" in page) {
                    lastError = page.error;
                    continue;
                }

                succeeded += 1;
                for (const node of page.search.nodes) {
                    if (node == null || typeof node !== "object" || !("number" in node) || !("repository" in node)) {
                        continue;
                    }
                    const summary = toSearchPullRequestSummary(node as SearchPullRequestNode);
                    if (
                        summary.state === "closed" ||
                        !wanted.has(summary.repository) ||
                        byKey.has(summary.key) ||
                        !matchesRelatedRefs(summary, input.headRefName, input.baseRefName)
                    ) {
                        continue;
                    }
                    byKey.set(summary.key, summary);
                }
            }

            if (succeeded === 0 && lastError) {
                throw lastError;
            }

            return [...byKey.values()].sort(comparePullRequestsByUpdatedAtDesc);
        },

        async getPullRequest(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            // Some credentials cannot read CheckRun nodes, so GitHub returns FORBIDDEN on those
            // context slots while still returning the PR and any StatusContext rows. Keep the
            // partial payload.
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
                    `${repository}#${number} does not exist, or this session cannot see it.`,
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
                        `${repository}#${number} does not exist, or this session cannot see it.`,
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

        async listComparedFiles(token, repository, baseOid, headOid) {
            const [owner = "", name = ""] = repository.split("/");
            const base = baseOid.trim();
            const head = headOid.trim();
            if (!base || !head) {
                throw new EasyReviewError("unknown", "Pick both a base and a head commit to compare.");
            }
            if (base === head) {
                return [];
            }

            const path = `/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
            const payload = (await restJson(token, "GET", path)) as {
                files?: Array<{
                    filename?: string;
                    previous_filename?: string | null;
                    status?: string;
                    additions?: number;
                    deletions?: number;
                }> | null;
                truncated?: boolean;
            };

            const files = (payload.files ?? []).flatMap((file) => {
                const filePath = file.filename?.trim();
                if (!filePath) {
                    return [];
                }
                return [
                    {
                        path: filePath,
                        previousPath: file.previous_filename?.trim() || null,
                        status: toComparedFileStatus(file.status),
                        additions: file.additions ?? 0,
                        deletions: file.deletions ?? 0,
                        stub: stubForPath(filePath),
                    } satisfies PullRequestFile,
                ];
            });

            if (payload.truncated) {
                throw new EasyReviewError(
                    "unknown",
                    `This commit range changes more files than GitHub returns in one compare. Narrow the base…to range.`,
                );
            }

            return files;
        },

        async getPullRequestFileDiff(token, repository, number, path, options) {
            const force = options?.force === true;
            const pathStub = stubForPath(path);

            // Binary path stubs never expand. Generated / huge-from-path can with force.
            if (pathStub === "binary" || (pathStub && !force)) {
                return { path, lines: [], truncated: false, stub: pathStub, beforeText: null, afterText: null };
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
                    `${repository}#${number} does not exist, or this session cannot see it.`,
                );
            }

            const beforePath = options?.previousPath || path;
            const rangeBase = options?.baseOid?.trim() || null;
            const rangeHead = options?.headOid?.trim() || null;
            // Prefer the virtual pull-request ref for the full-PR head side. Raw head OIDs 404 on
            // the Contents API for cross-fork PRs; `refs/pull/N/head` always resolves on the base repo.
            const beforeRef = rangeBase ?? pullRequest.baseRefOid;
            const afterRef = rangeHead && rangeHead !== pullRequest.headRefOid ? rangeHead : `refs/pull/${number}/head`;
            const [before, after] = await Promise.all([
                readBlob(token, owner, name, beforePath, beforeRef, force),
                readBlob(token, owner, name, path, afterRef, force),
            ]);

            if (before?.stub || after?.stub) {
                return {
                    path,
                    lines: [],
                    truncated: false,
                    stub: before?.stub ?? after?.stub ?? "huge",
                    beforeText: null,
                    afterText: null,
                };
            }

            if (!before?.bytes && !after?.bytes) {
                throw new EasyReviewError(
                    "not-found",
                    `Could not read ${path} on this pull request. The file may have been removed, or GitHub could not resolve the head commit.`,
                );
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
                        `${repository}#${number} does not exist, or this session cannot see it.`,
                    );
                }

                for (const node of connection.nodes) {
                    const thread = toReviewThread(node);
                    if (thread) {
                        threads.push(thread);
                    }
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
                // Same CheckRun FORBIDDEN caveat as getPullRequest — keep StatusContext rows.
                const data: PullRequestTimelineQuery = await graphql(
                    token,
                    PULL_REQUEST_TIMELINE_QUERY,
                    {
                        owner,
                        name,
                        number,
                        pageSize: TIMELINE_PAGE_SIZE,
                        cursor,
                    },
                    { keepPartial: true },
                );
                const connection = data.repository?.pullRequest?.timelineItems;
                if (!connection) {
                    throw new EasyReviewError(
                        "not-found",
                        `${repository}#${number} does not exist, or this session cannot see it.`,
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

        async listPullRequestCommits(token, repository, number) {
            const [owner = "", name = ""] = repository.split("/");
            const commits: Array<PullRequestCommit> = [];
            let cursor: string | null = null;

            for (let page = 0; page < COMMITS_PAGE_LIMIT; page++) {
                const data: PullRequestCommitsQuery = await graphql(
                    token,
                    PULL_REQUEST_COMMITS_QUERY,
                    {
                        owner,
                        name,
                        number,
                        pageSize: COMMITS_PAGE_SIZE,
                        cursor,
                    },
                    { keepPartial: true },
                );
                const connection = data.repository?.pullRequest?.commits;
                if (!connection) {
                    throw new EasyReviewError(
                        "not-found",
                        `${repository}#${number} does not exist, or this session cannot see it.`,
                    );
                }

                for (const node of connection.nodes) {
                    const commit = node?.commit;
                    if (!commit) {
                        continue;
                    }
                    const author = resolveCommitAuthor(commit.author);
                    commits.push({
                        oid: commit.oid,
                        abbreviatedOid: commit.abbreviatedOid,
                        messageHeadline: commit.messageHeadline,
                        committedAt: commit.committedDate,
                        authorLogin: author.login,
                        authorAvatarUrl: author.avatarUrl,
                        url: commit.url,
                        checkState: toCheckState(commit.statusCheckRollup?.state),
                    });
                }

                if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
                    break;
                }

                cursor = connection.pageInfo.endCursor;
            }

            return commits;
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

            const comment = toThreadComment(data.addPullRequestReviewThreadReply.comment);
            if (!comment) {
                throw new EasyReviewError("unknown", "Could not read the new reply from GitHub.");
            }

            return comment;
        },

        async setReviewThreadResolved(token, threadId, resolved) {
            await graphql(token, resolved ? RESOLVE_THREAD_MUTATION : UNRESOLVE_THREAD_MUTATION, { threadId });
        },

        async setPullRequestDraft(token, repository, number, isDraft) {
            const [owner = "", name = ""] = repository.split("/");
            // REST PATCH `draft` is ignored by GitHub — ready/draft flips need GraphQL mutations.
            const lookup = await graphql<{
                repository: { pullRequest: { id: string; isDraft: boolean } | null } | null;
            }>(
                token,
                `
                    query EasyReviewPullRequestId($owner: String!, $name: String!, $number: Int!) {
                        repository(owner: $owner, name: $name) {
                            pullRequest(number: $number) {
                                id
                                isDraft
                            }
                        }
                    }
                `,
                { owner, name, number },
            );

            const pullRequest = lookup.repository?.pullRequest;
            if (!pullRequest) {
                throw new EasyReviewError("not-found", "That pull request could not be found.");
            }

            if (pullRequest.isDraft === isDraft) {
                return;
            }

            if (isDraft) {
                await graphql(
                    token,
                    `
                        mutation EasyReviewConvertToDraft($pullRequestId: ID!) {
                            convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
                                pullRequest {
                                    isDraft
                                }
                            }
                        }
                    `,
                    { pullRequestId: pullRequest.id },
                );
                return;
            }

            await graphql(
                token,
                `
                    mutation EasyReviewMarkReadyForReview($pullRequestId: ID!) {
                        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
                            pullRequest {
                                isDraft
                            }
                        }
                    }
                `,
                { pullRequestId: pullRequest.id },
            );
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
            const current = await getRequestedReviewers(token, owner, name, number);
            const payload = resolveReviewRequestPayload(reviewers, current, { treatUnknownAsUserLogins: true }).all;
            await postReviewRequestPayload(token, owner, name, number, payload);
        },

        async removeReviewers(token, repository, number, reviewers) {
            if (reviewers.length === 0) {
                return;
            }

            const [owner = "", name = ""] = repository.split("/");
            const current = await getRequestedReviewers(token, owner, name, number);
            const payload = resolveReviewRequestPayload(reviewers, current).pending;
            await deleteReviewRequestPayload(token, owner, name, number, payload);
        },

        async reRequestReview(token, repository, number, reviewers) {
            if (reviewers.length === 0) {
                return;
            }

            const [owner = "", name = ""] = repository.split("/");
            const current = await getRequestedReviewers(token, owner, name, number);
            const { all, pending } = resolveReviewRequestPayload(reviewers, current, {
                treatUnknownAsUserLogins: true,
            });

            if (!hasReviewRequestPayload(all)) {
                return;
            }

            if (hasReviewRequestPayload(pending)) {
                await deleteReviewRequestPayload(token, owner, name, number, pending);
            }

            try {
                await postReviewRequestPayload(token, owner, name, number, all);
            } catch (error) {
                // Best-effort restore: DELETE already cleared pending requests; put them back
                // before surfacing the failure so the PR is not left without reviewers.
                if (hasReviewRequestPayload(pending)) {
                    try {
                        await postReviewRequestPayload(token, owner, name, number, pending);
                    } catch {
                        // Preserve the original POST failure.
                    }
                }

                throw error;
            }
        },

        async dismissReview(token, repository, number, reviewId, message) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PUT", `/repos/${owner}/${name}/pulls/${number}/reviews/${reviewId}/dismissals`, {
                message,
                event: "DISMISS",
            });
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

        async uploadPullRequestMedia(token, input) {
            try {
                const [owner = "", name = ""] = input.repository.split("/");
                const kind = mediaKindForNameAndType(input.fileName, input.contentType) ?? "image";
                const safeName = sanitizeMediaFileName(input.fileName);
                const uniqueName = `${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}-${safeName}`;
                const refSuffix = `uploads/pr/${input.number}`;

                let parentSha: string | undefined;
                let baseTreeSha: string | undefined;
                const existing = await rest(token, `/repos/${owner}/${name}/git/ref/${encodePath(refSuffix)}`);
                if (existing.ok) {
                    const ref = (await existing.json()) as { object?: { sha?: string } };
                    parentSha = ref.object?.sha;
                    if (parentSha) {
                        const commit = (await restJson(
                            token,
                            "GET",
                            `/repos/${owner}/${name}/git/commits/${parentSha}`,
                        )) as { tree: { sha: string } };
                        baseTreeSha = commit.tree.sha;
                    }
                } else if (existing.status !== 404) {
                    throw errorForStatus(existing);
                }

                const blob = (await restJson(token, "POST", `/repos/${owner}/${name}/git/blobs`, {
                    content: bytesToBase64(input.bytes),
                    encoding: "base64",
                })) as { sha: string };

                const treePayload: Record<string, unknown> = {
                    tree: [{ path: uniqueName, mode: "100644", type: "blob", sha: blob.sha }],
                };
                if (baseTreeSha) {
                    treePayload.base_tree = baseTreeSha;
                }
                const tree = (await restJson(token, "POST", `/repos/${owner}/${name}/git/trees`, treePayload)) as {
                    sha: string;
                };

                const commitPayload: Record<string, unknown> = {
                    message: `Upload ${safeName} for pull request #${input.number}`,
                    tree: tree.sha,
                    parents: parentSha ? [parentSha] : [],
                };
                const commit = (await restJson(
                    token,
                    "POST",
                    `/repos/${owner}/${name}/git/commits`,
                    commitPayload,
                )) as {
                    sha: string;
                };

                if (parentSha) {
                    await restJson(token, "PATCH", `/repos/${owner}/${name}/git/refs/${encodePath(refSuffix)}`, {
                        sha: commit.sha,
                        force: true,
                    });
                } else {
                    await restJson(token, "POST", `/repos/${owner}/${name}/git/refs`, {
                        ref: `refs/${refSuffix}`,
                        sha: commit.sha,
                    });
                }

                // Use web path encoding (keep `.`) — `encodePath`’s `%2E` breaks github.com / <img>.
                const url = `https://github.com/${owner}/${name}/blob/${commit.sha}/${encodeGithubWebPath(uniqueName)}?raw=true`;
                return { url, markdown: mediaMarkdown(kind, safeName, url) };
            } catch (cause) {
                if (cause instanceof EasyReviewError && cause.kind === "forbidden") {
                    throw new EasyReviewError("forbidden", MEDIA_UPLOAD_PERMISSION_MESSAGE, { cause });
                }
                throw cause;
            }
        },

        async resolveUserAttachment(token, repository, attachmentUrl) {
            if (!isGithubUserAttachmentUrl(attachmentUrl)) {
                return null;
            }

            let response: Response;
            try {
                response = await fetchImpl(`${REST_URL}/markdown`, {
                    method: "POST",
                    headers: {
                        ...authorizationHeaders(token),
                        accept: "application/vnd.github+json",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        text: attachmentUrl,
                        mode: "gfm",
                        context: repository,
                    }),
                    credentials,
                });
            } catch (cause) {
                throw new EasyReviewError("network", "Could not reach GitHub. Check your connection and try again.", {
                    cause,
                });
            }

            if (!response.ok) {
                throw errorForStatus(response);
            }

            return parseGithubAttachmentMarkdownHtml(await response.text());
        },

        async resolveRepoBlobMedia(token, mediaUrl) {
            const parsed = parseGithubRepoBlobRawUrl(mediaUrl);
            if (!parsed) {
                return null;
            }

            const [owner = "", name = ""] = parsed.repository.split("/");
            const payload = (await restJson(
                token,
                "GET",
                `/repos/${owner}/${name}/contents/${encodePath(parsed.path)}?ref=${encodeURIComponent(parsed.sha)}`,
            )) as {
                type?: string;
                encoding?: string;
                content?: string;
                download_url?: string | null;
                name?: string;
            };

            if (payload.type !== "file") {
                return null;
            }

            const kind = mediaKindFromPath(parsed.path);
            const fileName = payload.name ?? parsed.path.split("/").pop();

            if (typeof payload.download_url === "string" && payload.download_url.length > 0) {
                return {
                    kind,
                    src: payload.download_url,
                    ...(fileName ? { name: fileName } : {}),
                };
            }

            if (typeof payload.content === "string" && payload.encoding === "base64") {
                const mime = mimeFromMediaPath(parsed.path);
                const base64 = payload.content.replaceAll(/\s+/g, "");
                return {
                    kind,
                    src: `data:${mime};base64,${base64}`,
                    ...(fileName ? { name: fileName } : {}),
                };
            }

            return null;
        },

        async updatePullRequestBody(token, repository, number, body) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "PATCH", `/repos/${owner}/${name}/pulls/${number}`, { body });
        },

        async applySuggestions(token, input) {
            const [owner = "", name = ""] = input.repository.split("/");
            if (input.changes.length === 0) {
                throw new EasyReviewError("unknown", "No suggestions to apply.");
            }

            const byPath = new Map<string, Array<SuggestionChange>>();
            for (const change of input.changes) {
                const list = byPath.get(change.path) ?? [];
                list.push(change);
                byPath.set(change.path, list);
            }

            const commit = (await restJson(token, "GET", `/repos/${owner}/${name}/git/commits/${input.headSha}`)) as {
                tree: { sha: string };
            };
            const baseTreeSha = commit.tree.sha;

            const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
            for (const [path, changes] of byPath) {
                const blob = await readBlob(token, owner, name, path, input.headSha, true);
                if (!blob?.bytes) {
                    throw new EasyReviewError("unknown", `Could not read ${path} on the head branch.`);
                }
                const text = new TextDecoder().decode(blob.bytes);
                const next = applySuggestionsToFile(text, changes);
                const created = (await restJson(token, "POST", `/repos/${owner}/${name}/git/blobs`, {
                    content: next,
                    encoding: "utf-8",
                })) as { sha: string };
                tree.push({ path, mode: "100644", type: "blob", sha: created.sha });
            }

            const newTree = (await restJson(token, "POST", `/repos/${owner}/${name}/git/trees`, {
                base_tree: baseTreeSha,
                tree,
            })) as { sha: string };

            const newCommit = (await restJson(token, "POST", `/repos/${owner}/${name}/git/commits`, {
                message: input.message,
                tree: newTree.sha,
                parents: [input.headSha],
            })) as { sha: string };

            const ref = `heads/${input.headRefName}`;
            await restJson(token, "PATCH", `/repos/${owner}/${name}/git/refs/${encodePath(ref)}`, {
                sha: newCommit.sha,
            });
        },

        async updatePullRequest(token, repository, number, input) {
            const [owner = "", name = ""] = repository.split("/");
            const body: Record<string, string> = {};
            if (input.title !== undefined) {
                body.title = input.title;
            }
            if (input.base !== undefined) {
                body.base = input.base;
            }
            if (Object.keys(body).length === 0) {
                return;
            }
            await restJson(token, "PATCH", `/repos/${owner}/${name}/pulls/${number}`, body);
        },

        async listRepositoryBranches(token, repository) {
            const [owner = "", name = ""] = repository.split("/");
            const names: Array<string> = [];
            let page = 1;
            while (page <= 5) {
                const rows = (await restJson(
                    token,
                    "GET",
                    `/repos/${owner}/${name}/branches?per_page=100&page=${page}`,
                )) as Array<{ name: string }>;
                for (const row of rows) {
                    names.push(row.name);
                }
                if (rows.length < 100) {
                    break;
                }
                page += 1;
            }
            return names;
        },

        async createIssueReaction(token, repository, number, content) {
            const [owner = "", name = ""] = repository.split("/");
            const created = (await restJson(token, "POST", `/repos/${owner}/${name}/issues/${number}/reactions`, {
                content,
            })) as { id: number };
            return created.id;
        },

        async deleteIssueReaction(token, repository, number, reactionId) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(token, "DELETE", `/repos/${owner}/${name}/issues/${number}/reactions/${reactionId}`);
        },

        async findIssueReactionId(token, repository, number, content, viewerLogin) {
            const [owner = "", name = ""] = repository.split("/");
            const rows = (await restJson(
                token,
                "GET",
                `/repos/${owner}/${name}/issues/${number}/reactions?content=${encodeURIComponent(content)}&per_page=100`,
            )) as Array<{ id: number; user: { login: string } | null; content: string }>;
            return rows.find((row) => row.user?.login === viewerLogin)?.id ?? null;
        },

        async createIssueCommentReaction(token, repository, commentId, content) {
            const [owner = "", name = ""] = repository.split("/");
            const created = (await restJson(
                token,
                "POST",
                `/repos/${owner}/${name}/issues/comments/${commentId}/reactions`,
                { content },
            )) as { id: number };
            return created.id;
        },

        async deleteIssueCommentReaction(token, repository, commentId, reactionId) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(
                token,
                "DELETE",
                `/repos/${owner}/${name}/issues/comments/${commentId}/reactions/${reactionId}`,
            );
        },

        async findIssueCommentReactionId(token, repository, commentId, content, viewerLogin) {
            const [owner = "", name = ""] = repository.split("/");
            const rows = (await restJson(
                token,
                "GET",
                `/repos/${owner}/${name}/issues/comments/${commentId}/reactions?content=${encodeURIComponent(content)}&per_page=100`,
            )) as Array<{ id: number; user: { login: string } | null; content: string }>;
            return rows.find((row) => row.user?.login === viewerLogin)?.id ?? null;
        },

        async createReviewCommentReaction(token, repository, commentId, content) {
            const [owner = "", name = ""] = repository.split("/");
            const created = (await restJson(
                token,
                "POST",
                `/repos/${owner}/${name}/pulls/comments/${commentId}/reactions`,
                { content },
            )) as { id: number };
            return created.id;
        },

        async deleteReviewCommentReaction(token, repository, commentId, reactionId) {
            const [owner = "", name = ""] = repository.split("/");
            await restJson(
                token,
                "DELETE",
                `/repos/${owner}/${name}/pulls/comments/${commentId}/reactions/${reactionId}`,
            );
        },

        async findReviewCommentReactionId(token, repository, commentId, content, viewerLogin) {
            const [owner = "", name = ""] = repository.split("/");
            const rows = (await restJson(
                token,
                "GET",
                `/repos/${owner}/${name}/pulls/comments/${commentId}/reactions?content=${encodeURIComponent(content)}&per_page=100`,
            )) as Array<{ id: number; user: { login: string } | null; content: string }>;
            return rows.find((row) => row.user?.login === viewerLogin)?.id ?? null;
        },
    };

    async function restJson(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
        let response: Response;

        try {
            response = await fetchImpl(`${REST_URL}${path}`, {
                method,
                headers: {
                    ...authorizationHeaders(token),
                    accept: "application/vnd.github+json",
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                credentials,
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

    async function getRequestedReviewers(
        token: string,
        owner: string,
        name: string,
        number: number,
    ): Promise<RequestedReviewersSnapshot> {
        const data = (await restJson(token, "GET", `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`)) as {
            users?: Array<{ login: string }>;
            teams?: Array<{ name: string; slug: string }>;
        };

        return {
            users: data.users ?? [],
            teams: data.teams ?? [],
        };
    }

    async function postReviewRequestPayload(
        token: string,
        owner: string,
        name: string,
        number: number,
        payload: ReviewRequestPayload,
    ): Promise<void> {
        if (!hasReviewRequestPayload(payload)) {
            return;
        }

        await restJson(token, "POST", `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`, payload);
    }

    async function deleteReviewRequestPayload(
        token: string,
        owner: string,
        name: string,
        number: number,
        payload: ReviewRequestPayload,
    ): Promise<void> {
        if (!hasReviewRequestPayload(payload)) {
            return;
        }

        await restJson(token, "DELETE", `/repos/${owner}/${name}/pulls/${number}/requested_reviewers`, {
            reviewers: payload.reviewers,
            ...(payload.team_reviewers.length > 0 ? { team_reviewers: payload.team_reviewers } : {}),
        });
    }

    async function rest(token: string, path: string, accept = "application/vnd.github+json"): Promise<Response> {
        try {
            return await fetchImpl(`${REST_URL}${path}`, {
                headers: {
                    ...authorizationHeaders(token),
                    accept,
                },
                credentials,
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
     * When GitHub omits inline content (blobs over ~1 MB), we either stub as huge or fetch the
     * raw Contents API representation through the same REST base (proxy-friendly).
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

        // Prefer the Contents API raw media type so large blobs stay on the same-origin proxy
        // instead of hitting raw.githubusercontent.com with a browser-held token.
        const contentsPath = `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
        const download = await rest(token, contentsPath, "application/vnd.github.raw");

        if (!download.ok) {
            throw errorForStatus(download);
        }

        return { bytes: new Uint8Array(await download.arrayBuffer()) };
    }
}

/** Encode each path segment so nested paths survive the Contents API.
 * Dots are encoded too: Vite's dev middleware treats bare `.ts` / `.tsx` / `.css` URLs under
 * `/api/github/...` as modules and returns 404 before the proxy runs.
 */
function encodePath(path: string): string {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment).replaceAll(".", "%2E"))
        .join("/");
}

/** Path segments for `github.com/.../blob/...` URLs — keep `.` so browsers and GitHub resolve media. */
function encodeGithubWebPath(path: string): string {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function mimeFromMediaPath(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
}

type RequestedReviewersSnapshot = {
    users: Array<{ login: string }>;
    teams: Array<{ name: string; slug: string }>;
};

type ReviewRequestPayload = {
    reviewers: string[];
    team_reviewers: string[];
};

function hasReviewRequestPayload(payload: ReviewRequestPayload): boolean {
    return payload.reviewers.length > 0 || payload.team_reviewers.length > 0;
}

/** Map UI identifiers (user logins or team names/slugs) to GitHub REST review-request bodies. */
export function resolveReviewRequestPayload(
    identifiers: ReadonlyArray<string>,
    current: RequestedReviewersSnapshot,
    options: { treatUnknownAsUserLogins?: boolean } = {},
): { all: ReviewRequestPayload; pending: ReviewRequestPayload } {
    const pendingUserLogins = new Set(current.users.map((user) => user.login));
    const teamSlugByName = new Map(current.teams.map((team) => [team.name, team.slug]));
    const teamSlugs = new Set(current.teams.map((team) => team.slug));

    const all: ReviewRequestPayload = { reviewers: [], team_reviewers: [] };
    const pending: ReviewRequestPayload = { reviewers: [], team_reviewers: [] };

    for (const identifier of identifiers) {
        if (pendingUserLogins.has(identifier)) {
            all.reviewers.push(identifier);
            pending.reviewers.push(identifier);
            continue;
        }

        const teamSlug = teamSlugByName.get(identifier) ?? (teamSlugs.has(identifier) ? identifier : null);
        if (teamSlug) {
            all.team_reviewers.push(teamSlug);
            pending.team_reviewers.push(teamSlug);
            continue;
        }

        if (options.treatUnknownAsUserLogins) {
            all.reviewers.push(identifier);
        }
    }

    return { all, pending };
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
    /** Issue comments + review comments — matches GitHub’s Conversation tab badge. */
    totalCommentsCount: number | null;
    reviewRequests: {
        nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }>;
    };
    latestReviews: {
        nodes: Array<{ databaseId: number | null; author: { login: string } | null; state: string }>;
    };
    commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    labels: { nodes: Array<{ name: string; color: string }> } | null;
    assignees: { nodes: Array<{ login: string }> };
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
            review.author && review.databaseId != null
                ? [
                      {
                          login: review.author.login,
                          state: toReviewState(review.state),
                          reviewId: review.databaseId,
                      },
                  ]
                : [],
        ),
        checks: toCheckState(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        commentCount: node.totalCommentsCount ?? 0,
        mergeable: toMergeableState(node.mergeable),
        assignees: node.assignees.nodes.map((assignee) => assignee.login),
        labels: node.labels?.nodes ?? [],
    };
}

type SearchPullRequestNode = {
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    createdAt: string;
    updatedAt: string;
    mergedAt: string | null;
    headRefName: string;
    baseRefName: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    author: { login: string; avatarUrl: string } | null;
    repository: { nameWithOwner: string };
};

type SearchPullRequestsQuery = {
    search: { nodes: Array<SearchPullRequestNode | Record<string, never> | null> };
};

type LookupPullRequestsByNumberQuery = Record<string, { pullRequest: SearchPullRequestNode | null } | null>;

/** One aliased `repository { pullRequest(number) }` per repo — cheap number search for the palette. */
function buildLookupPullRequestsByNumberQuery(repositories: ReadonlyArray<string>, number: number): string {
    const selections = repositories.map((nameWithOwner, index) => {
        const [owner = "", name = ""] = nameWithOwner.split("/");
        return `
            repo${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
                pullRequest(number: ${number}) {
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
                    author {
                        login
                        avatarUrl
                    }
                    repository {
                        nameWithOwner
                    }
                }
            }
        `;
    });

    return `
        query EasyReviewLookupPullRequestsByNumber {
            ${selections.join("\n")}
        }
    `;
}

/** GitHub rejects search queries longer than this. */
const SEARCH_QUERY_MAX_LENGTH = 256;

/**
 * Build GitHub search strings for related PRs: same head + base, not closed, scoped to repos.
 * Packs repositories into batches under the query length limit.
 */
function buildRelatedSearchQueryBatches(input: {
    headRefName: string;
    baseRefName: string;
    repositories: ReadonlyArray<string>;
}): Array<string> {
    if (input.repositories.length === 0 || !input.headRefName || !input.baseRefName) {
        return [];
    }

    const head = quoteGitHubSearchToken(input.headRefName);
    const base = quoteGitHubSearchToken(input.baseRefName);
    const prefix = `is:pr -is:closed head:${head} base:${base}`;
    const batches: Array<string> = [];

    for (let index = 0; index < input.repositories.length; index += RELATED_SEARCH_REPO_BATCH_SIZE) {
        const slice = input.repositories.slice(index, index + RELATED_SEARCH_REPO_BATCH_SIZE);
        let current = prefix;
        for (const repository of slice) {
            const qualifier = ` repo:${repository}`;
            if (current.length + qualifier.length > SEARCH_QUERY_MAX_LENGTH) {
                break;
            }
            current += qualifier;
        }
        if (current !== prefix) {
            batches.push(current);
        }
    }

    return batches;
}

function quoteGitHubSearchToken(value: string): string {
    if (/^[A-Za-z0-9._/-]+$/.test(value)) {
        return value;
    }
    return `"${value.replaceAll('"', "")}"`;
}

/** Build a GitHub search string scoped to titles in selected repos. */
function buildPullRequestSearchQueryBatches(raw: string, repositories: ReadonlyArray<string>): Array<string> {
    const cleaned = raw.trim().replaceAll('"', "").replace(/\s+/g, " ");
    if (!cleaned || repositories.length === 0) {
        return [];
    }

    const prefix = `${cleaned} in:title is:pr sort:updated-desc`;
    const batches: Array<string> = [];
    let current = prefix;

    for (const repository of repositories) {
        const qualifier = ` repo:${repository}`;
        if (current.length + qualifier.length > SEARCH_QUERY_MAX_LENGTH) {
            if (current !== prefix) {
                batches.push(current);
            }
            current = `${prefix}${qualifier}`;
            if (current.length > SEARCH_QUERY_MAX_LENGTH) {
                // Single repo still too long with the prefix — skip rather than fail the whole search.
                current = prefix;
                continue;
            }
            continue;
        }
        current += qualifier;
    }

    if (current !== prefix) {
        batches.push(current);
    }

    return batches;
}

function toSearchPullRequestSummary(node: SearchPullRequestNode): PullRequestSummary {
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
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "none",
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        commentCount: 0,
        mergeable: "unknown",
        assignees: [],
        labels: [],
    };
}

const SEARCH_PULL_REQUESTS_QUERY = `
    query EasyReviewSearchPullRequests($query: String!, $first: Int!) {
        search(query: $query, type: ISSUE, first: $first) {
            nodes {
                ... on PullRequest {
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
                    author {
                        login
                        avatarUrl
                    }
                    repository {
                        nameWithOwner
                    }
                }
            }
        }
    }
`;

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
    mergeable
    reviewDecision
    author {
        login
        avatarUrl
    }
    repository {
        nameWithOwner
    }
    totalCommentsCount
    reviewRequests(first: 10) {
        nodes {
            requestedReviewer {
                ... on User {
                    login
                }
                ... on Team {
                    name
                    slug
                }
            }
        }
    }
    latestReviews(first: 20) {
        nodes {
            databaseId
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
`;

type CheckContextNode = CheckContextInput | null;

/**
 * The overview asks for the same fields as an Inbox row plus the ones only a whole page has
 * room for. GraphQL merges the two `commits` selections, so the head SHA and the individual
 * check runs arrive alongside the rollup the row already used.
 */
type ReactionGroupNode = {
    content: string;
    viewerHasReacted: boolean;
    reactors: { totalCount: number };
};

type ContentEditorNode = {
    __typename?: string;
    login: string;
    avatarUrl?: string | null;
} | null;

type ContentEditNode = {
    /** Prefer this; fall back to `createdAt` on older schema responses. */
    editedAt?: string | null;
    createdAt?: string | null;
    editor: ContentEditorNode;
};

type UserContentEditsNode = {
    totalCount: number;
    nodes: Array<ContentEditNode | null>;
};

type PullRequestDetailNode = Omit<PullRequestNode, "commits"> & {
    body: string;
    lastEditedAt: string | null;
    includesCreatedEdit: boolean;
    editor: ContentEditorNode;
    userContentEdits: UserContentEditsNode | null;
    reactionGroups: Array<ReactionGroupNode>;
    baseRefOid: string;
    headRefOid: string;
    mergeStateStatus: string;
    viewerCanMergeAsAdmin: boolean;
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
                statusCheckRollup: {
                    state: string;
                    contexts: { totalCount?: number; nodes: Array<CheckContextNode> };
                } | null;
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
                lastEditedAt
                includesCreatedEdit
                editor {
                    __typename
                    login
                    avatarUrl
                }
                userContentEdits(last: 20) {
                    totalCount
                    nodes {
                        editedAt
                        createdAt
                        editor {
                            __typename
                            login
                            avatarUrl
                        }
                    }
                }
                reactionGroups {
                    content
                    viewerHasReacted
                    reactors {
                        totalCount
                    }
                }
                baseRefOid
                headRefOid
                mergeStateStatus
                viewerCanMergeAsAdmin
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
                                    totalCount
                                    nodes {
                                        __typename
                                        ... on CheckRun {
                                            name
                                            status
                                            conclusion
                                            detailsUrl
                                            startedAt
                                            completedAt
                                            checkSuite {
                                                workflowRun {
                                                    event
                                                    workflow {
                                                        name
                                                    }
                                                }
                                            }
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

type PullRequestCommitsQuery = {
    repository: {
        pullRequest: {
            commits: {
                nodes: Array<{
                    commit: {
                        oid: string;
                        abbreviatedOid: string;
                        messageHeadline: string;
                        committedDate: string;
                        url: string;
                        author: {
                            name: string | null;
                            avatarUrl: string | null;
                            user: { login: string; avatarUrl: string | null } | null;
                        } | null;
                        statusCheckRollup: { state: string } | null;
                    };
                } | null>;
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
            } | null;
        } | null;
    } | null;
};

const PULL_REQUEST_COMMITS_QUERY = `
    query EasyReviewPullRequestCommits(
        $owner: String!
        $name: String!
        $number: Int!
        $pageSize: Int!
        $cursor: String
    ) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                commits(first: $pageSize, after: $cursor) {
                    nodes {
                        commit {
                            oid
                            abbreviatedOid
                            messageHeadline
                            committedDate
                            url
                            author {
                                name
                                avatarUrl
                                user {
                                    login
                                    avatarUrl
                                }
                            }
                            statusCheckRollup {
                                state
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
                            databaseId
                            body
                            createdAt
                            url
                            lastEditedAt
                            includesCreatedEdit
                            author {
                                login
                                avatarUrl
                            }
                            editor {
                                __typename
                                login
                                avatarUrl
                            }
                            userContentEdits(last: 20) {
                                totalCount
                                nodes {
                                    editedAt
                                    createdAt
                                    editor {
                                        __typename
                                        login
                                        avatarUrl
                                    }
                                }
                            }
                            reactionGroups {
                                content
                                viewerHasReacted
                                reactors {
                                    totalCount
                                }
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
                                    avatarUrl
                                    user {
                                        login
                                        avatarUrl
                                    }
                                    name
                                }
                                signature {
                                    __typename
                                    isValid
                                    email
                                    signer {
                                        login
                                        name
                                        avatarUrl
                                    }
                                    ... on GpgSignature {
                                        keyId
                                    }
                                    ... on SshSignature {
                                        keyFingerprint
                                    }
                                }
                                statusCheckRollup {
                                    state
                                    contexts(first: 50) {
                                        nodes {
                                            __typename
                                            ... on CheckRun {
                                                name
                                                status
                                                conclusion
                                                detailsUrl
                                                startedAt
                                                completedAt
                                                checkSuite {
                                                    workflowRun {
                                                        event
                                                        workflow {
                                                            name
                                                        }
                                                    }
                                                }
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
          databaseId: number | null;
          body: string;
          createdAt: string;
          url: string;
          lastEditedAt: string | null;
          includesCreatedEdit: boolean;
          author: TimelineActorNode;
          editor: ContentEditorNode;
          userContentEdits: UserContentEditsNode | null;
          reactionGroups: Array<ReactionGroupNode>;
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
              author: {
                  avatarUrl: string | null;
                  user: TimelineActorNode;
                  name: string | null;
              } | null;
              signature: {
                  __typename: string;
                  isValid: boolean;
                  email: string | null;
                  signer: { login: string; name: string | null; avatarUrl: string | null } | null;
                  keyId?: string | null;
                  keyFingerprint?: string | null;
              } | null;
              statusCheckRollup: {
                  state: string;
                  contexts: { nodes: Array<CheckContextNode> } | null;
              } | null;
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
    const login = actor?.login ?? "ghost";
    return {
        login,
        avatarUrl:
            actor?.avatarUrl ??
            (/^[\w-]+$/.test(login) && login !== "ghost" ? `https://github.com/${login}.png?size=40` : null),
    };
}

/**
 * Prefer the linked GitHub user avatar (same as timeline actors). GitActor.avatarUrl is often an
 * email gravatar that disagrees with the profile avatar GitHub shows for that person.
 */
function resolveCommitAuthor(
    author:
        | {
              avatarUrl: string | null;
              name: string | null;
              user: { login: string; avatarUrl: string | null } | null;
          }
        | null
        | undefined,
): { login: string; avatarUrl: string | null } {
    if (author?.user) {
        return {
            login: author.user.login,
            avatarUrl: author.user.avatarUrl ?? `https://github.com/${author.user.login}.png?size=40`,
        };
    }

    const name = author?.name?.trim() ?? "";
    if (/^[\w-]+$/.test(name)) {
        return {
            login: name,
            avatarUrl: `https://github.com/${name}.png?size=40`,
        };
    }

    return {
        login: name || "ghost",
        avatarUrl: author?.avatarUrl ?? null,
    };
}

function toTimelineReviewer(reviewer: { login?: string; name?: string } | null): string {
    return reviewer?.login ?? reviewer?.name ?? "someone";
}

function toCommitSignature(
    signature: {
        isValid: boolean;
        signer: { login: string; name: string | null; avatarUrl: string | null } | null;
        keyId?: string | null;
        keyFingerprint?: string | null;
    } | null,
): CommitSignature | null {
    if (!signature) {
        return null;
    }

    return {
        verified: signature.isValid,
        keyId: signature.keyId ?? signature.keyFingerprint ?? null,
        signerLogin: signature.signer?.login ?? null,
        signerName: signature.signer?.name ?? null,
        signerAvatarUrl: signature.signer?.avatarUrl ?? null,
    };
}

function toTimelineItem(node: TimelineNode): PullRequestTimelineItem | null {
    if (!node) {
        return null;
    }

    switch (node.__typename) {
        case "IssueComment": {
            if (node.databaseId == null) {
                return null;
            }
            const { editCount, edits } = toContentEdits(node.userContentEdits, {
                includesCreatedEdit: node.includesCreatedEdit,
                createdAt: node.createdAt,
                fallback:
                    node.lastEditedAt && node.editor ? { editedAt: node.lastEditedAt, editor: node.editor } : null,
            });
            return {
                kind: "comment",
                id: node.id,
                databaseId: node.databaseId,
                author: node.author?.login ?? "ghost",
                authorAvatarUrl: node.author?.avatarUrl ?? null,
                body: node.body,
                createdAt: node.createdAt,
                url: node.url,
                lastEditedAt: node.lastEditedAt ?? null,
                editor: toContentEditor(node.editor),
                editCount,
                edits,
                reactionGroups: toReactionGroups(node.reactionGroups),
            };
        }
        case "PullRequestCommit": {
            const commit = node.commit;
            const author = resolveCommitAuthor(commit.author);
            return {
                kind: "commit",
                id: node.id,
                createdAt: commit.committedDate,
                author,
                messageHeadline: commit.messageHeadline,
                oid: commit.oid,
                abbreviatedOid: commit.abbreviatedOid,
                url: commit.url,
                checkState: toCheckState(commit.statusCheckRollup?.state),
                checkRuns: mapCheckRuns(commit.statusCheckRollup?.contexts?.nodes ?? []),
                signature: toCommitSignature(commit.signature),
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

function toComparedFileStatus(status: string | undefined): FileChangeStatus {
    switch (status) {
        case "added":
            return "added";
        case "removed":
            return "removed";
        case "renamed":
        case "copied":
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

/**
 * GitHub’s Checks-tab badge counts CheckRuns only (not legacy StatusContexts like CodeRabbit).
 * When CheckRun context slots are forbidden, GitHub nulls them out while leaving StatusContext
 * rows — count those nulls as redacted CheckRuns so the badge still matches GitHub.
 */
function toCheckCount(
    commit:
        | {
              statusCheckRollup: { contexts: { nodes: Array<CheckContextNode> } } | null;
          }
        | undefined,
): number {
    const nodes = commit?.statusCheckRollup?.contexts.nodes ?? [];
    let checkRuns = 0;
    let redacted = 0;
    for (const context of nodes) {
        if (context === null) {
            redacted += 1;
        } else if (context.__typename === "CheckRun") {
            checkRuns += 1;
        }
    }
    return checkRuns + redacted;
}

function toMergeStateStatus(status: string | null | undefined): MergeStateStatus {
    switch (status) {
        case "BEHIND":
            return "behind";
        case "BLOCKED":
            return "blocked";
        case "CLEAN":
            return "clean";
        case "DIRTY":
            return "dirty";
        case "DRAFT":
            return "draft";
        case "HAS_HOOKS":
            return "has_hooks";
        case "UNSTABLE":
            return "unstable";
        default:
            return "unknown";
    }
}

function toMergeableState(mergeable: PullRequestNode["mergeable"] | null | undefined): MergeableState {
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

function toReactionContent(content: string): ReactionContent | null {
    switch (content) {
        case "THUMBS_UP":
        case "+1":
            return "+1";
        case "THUMBS_DOWN":
        case "-1":
            return "-1";
        case "LAUGH":
        case "laugh":
            return "laugh";
        case "HOORAY":
        case "hooray":
            return "hooray";
        case "CONFUSED":
        case "confused":
            return "confused";
        case "HEART":
        case "heart":
            return "heart";
        case "ROCKET":
        case "rocket":
            return "rocket";
        case "EYES":
        case "eyes":
            return "eyes";
        default:
            return null;
    }
}

function toReactionGroups(nodes: Array<ReactionGroupNode> | null | undefined): Array<ReactionGroup> {
    const groups: Array<ReactionGroup> = [];
    for (const node of nodes ?? []) {
        const content = toReactionContent(node.content);
        if (!content || node.reactors.totalCount === 0) {
            continue;
        }
        groups.push({
            content,
            count: node.reactors.totalCount,
            viewerHasReacted: node.viewerHasReacted,
        });
    }
    return groups;
}

function toContentEditor(node: ContentEditorNode): ContentEditor | null {
    if (!node?.login) {
        return null;
    }
    return {
        login: node.login,
        avatarUrl: node.avatarUrl ?? null,
        isBot: node.__typename === "Bot" || /\[bot\]$/i.test(node.login),
    };
}

function toContentEdits(
    edits: UserContentEditsNode | null | undefined,
    options: {
        includesCreatedEdit?: boolean;
        createdAt?: string;
        fallback?: { editedAt: string; editor: ContentEditorNode } | null;
    } = {},
): {
    editCount: number;
    edits: Array<ContentEdit>;
} {
    const nodes = (edits?.nodes ?? []).filter((node): node is ContentEditNode => node != null);
    let mapped = nodes.flatMap((node) => {
        const editedAt = node.editedAt ?? node.createdAt;
        if (!editedAt) {
            return [];
        }
        return [{ editedAt, editor: toContentEditor(node.editor) }];
    });

    // GitHub often embeds the original “created” row in this connection — the popover shows that
    // separately, so drop it when GitHub says it is present.
    if (options.includesCreatedEdit && options.createdAt) {
        mapped = mapped.filter((edit) => edit.editedAt !== options.createdAt);
    }

    mapped = [...mapped].sort((a, b) => b.editedAt.localeCompare(a.editedAt));

    if (mapped.length === 0 && options.fallback?.editedAt) {
        mapped = [
            {
                editedAt: options.fallback.editedAt,
                editor: toContentEditor(options.fallback.editor),
            },
        ];
    }

    const total = edits?.totalCount ?? mapped.length;
    const withoutCreated = options.includesCreatedEdit && total > 0 ? Math.max(0, total - 1) : total;
    const editCount = mapped.length > 0 ? mapped.length : withoutCreated;

    return { editCount, edits: mapped };
}

function toPullRequestDetail(node: PullRequestDetailNode, settings: RepositoryMergeSettings): PullRequestDetail {
    const commit = node.commits.nodes[0]?.commit;
    const allowedMergeMethods = toAllowedMergeMethods(settings);
    const { editCount, edits } = toContentEdits(node.userContentEdits, {
        includesCreatedEdit: node.includesCreatedEdit,
        createdAt: node.createdAt,
        fallback: node.lastEditedAt && node.editor ? { editedAt: node.lastEditedAt, editor: node.editor } : null,
    });

    return {
        ...toPullRequestSummary(node),
        body: node.body,
        lastEditedAt: node.lastEditedAt ?? null,
        editor: toContentEditor(node.editor),
        editCount,
        edits,
        reactionGroups: toReactionGroups(node.reactionGroups),
        headSha: node.headRefOid || commit?.oid || "",
        baseSha: node.baseRefOid,
        labels: node.labels?.nodes ?? [],
        assignees: node.assignees.nodes.map((assignee) => assignee.login),
        checkRuns: mapCheckRuns(commit?.statusCheckRollup?.contexts.nodes ?? []),
        checkCount: toCheckCount(commit),
        requiredApprovingReviewCount: toRequiredApprovingReviewCount(node),
        allowedMergeMethods,
        defaultMergeMethod: toDefaultMergeMethod(settings, allowedMergeMethods),
        commitCount: node.commits.totalCount,
        mergeStateStatus: toMergeStateStatus(node.mergeStateStatus),
        viewerCanMergeAsAdmin: node.viewerCanMergeAsAdmin ?? false,
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

type RestInstallationNode = {
    id: number;
};

async function listInstallationIds(
    token: string,
    rest: (token: string, path: string, accept?: string) => Promise<Response>,
): Promise<Array<number>> {
    const ids: Array<number> = [];
    let path: string | null = `/user/installations?per_page=${REPOSITORY_PAGE_SIZE}`;

    for (let page = 0; page < REPOSITORY_PAGE_LIMIT && path; page++) {
        const response = await rest(token, path);

        if (!response.ok) {
            throw errorForStatus(response);
        }

        const payload = (await response.json()) as { installations?: Array<RestInstallationNode> };
        for (const installation of payload.installations ?? []) {
            ids.push(installation.id);
        }

        path = nextRestPath(response.headers.get("link"));
    }

    return ids;
}

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
        databaseId: node.id,
        author: node.user?.login ?? "ghost",
        authorAvatarUrl: node.user?.avatar_url ?? null,
        body: node.body,
        createdAt: node.created_at,
        url: node.html_url,
        lastEditedAt: null,
        editor: null,
        editCount: 0,
        edits: [],
        reactionGroups: [],
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
    databaseId: number | null;
    url: string;
    body: string;
    createdAt: string;
    diffHunk?: string | null;
    author: { login: string; avatarUrl: string | null } | null;
    reactionGroups: Array<ReactionGroupNode>;
};

type ReviewThreadNode = {
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    startLine: number | null;
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
                        isOutdated
                        path
                        startLine
                        line
                        diffSide
                        comments(first: 50) {
                            nodes {
                                id
                                databaseId
                                url
                                body
                                createdAt
                                diffHunk
                                author {
                                    login
                                    avatarUrl
                                }
                                reactionGroups {
                                    content
                                    viewerHasReacted
                                    reactors {
                                        totalCount
                                    }
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
                databaseId
                url
                body
                createdAt
                author {
                    login
                    avatarUrl
                }
                reactionGroups {
                    content
                    viewerHasReacted
                    reactors {
                        totalCount
                    }
                }
            }
        }
    }
`;

const RESOLVE_THREAD_MUTATION = `
    mutation EasyReviewResolveThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
            thread {
                id
                isResolved
            }
        }
    }
`;

const UNRESOLVE_THREAD_MUTATION = `
    mutation EasyReviewUnresolveThread($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
            thread {
                id
                isResolved
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

function toThreadComment(node: ReviewThreadCommentNode): ReviewThreadComment | null {
    if (node.databaseId == null) {
        return null;
    }

    return {
        id: node.id,
        databaseId: node.databaseId,
        author: node.author?.login ?? "ghost",
        authorAvatarUrl: node.author?.avatarUrl ?? null,
        body: node.body,
        createdAt: node.createdAt,
        url: node.url,
        reactionGroups: toReactionGroups(node.reactionGroups),
    };
}

function toReviewThread(node: ReviewThreadNode): ReviewThread | null {
    const comments = node.comments.nodes.flatMap((comment) => {
        const mapped = toThreadComment(comment);
        return mapped ? [mapped] : [];
    });

    if (comments.length === 0) {
        return null;
    }

    return {
        id: node.id,
        path: node.path,
        startLine: node.startLine,
        line: node.line,
        side: node.diffSide,
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        diffHunk: node.comments.nodes[0]?.diffHunk ?? null,
        comments,
    };
}
