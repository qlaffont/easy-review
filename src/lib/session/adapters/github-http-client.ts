import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type { Repository } from "#/lib/session/types.ts";

import { EasyReviewError } from "#/lib/session/errors.ts";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REPOSITORY_PAGE_SIZE = 100;
/** Stops a runaway account with thousands of repos from burning the rate limit in one go. */
const REPOSITORY_PAGE_LIMIT = 10;

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
    async function graphql<TData>(token: string, query: string, variables?: Record<string, unknown>): Promise<TData> {
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
            throw errorForGraphqlErrors(payload.errors);
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
