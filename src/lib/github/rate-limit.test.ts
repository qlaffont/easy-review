import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import {
    githubRateLimit,
    isGithubRateLimitLow,
    rateLimitFromHeaders,
    recordGithubRateLimit,
    resetGithubRateLimit,
} from "#/lib/github/rate-limit.ts";
import { revalidateInboxInBackground } from "#/lib/query/invalidate.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

const IN_AN_HOUR = Math.floor(Date.now() / 1000) + 3600;

function budget(remaining: number, resetEpochSeconds = IN_AN_HOUR) {
    return rateLimitFromHeaders(
        new Headers({
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": String(remaining),
            "x-ratelimit-reset": String(resetEpochSeconds),
            "x-ratelimit-resource": "graphql",
        }),
    )!;
}

afterEach(() => {
    resetGithubRateLimit();
});

describe("GitHub rate limit budget", () => {
    it("reads GitHub's rate limit headers", () => {
        expect(budget(4200)).toEqual({
            resource: "graphql",
            limit: 5000,
            remaining: 4200,
            resetAt: new Date(IN_AN_HOUR * 1000).toISOString(),
        });
        expect(rateLimitFromHeaders(new Headers())).toBeNull();
    });

    it("is low under a tenth of the hourly budget, until the window resets", () => {
        recordGithubRateLimit(budget(600));
        expect(isGithubRateLimitLow()).toBe(false);

        recordGithubRateLimit(budget(400));
        expect(isGithubRateLimitLow()).toBe(true);

        expect(isGithubRateLimitLow("graphql", (IN_AN_HOUR + 1) * 1000)).toBe(false);
        expect(githubRateLimit("graphql", (IN_AN_HOUR + 1) * 1000)).toBeNull();
    });

    it("hears about the budget from every GitHub response", async () => {
        const seen: Array<number> = [];
        const github = createGithubHttpClient(
            (async () =>
                new Response(JSON.stringify({ data: { viewer: { login: "octocat", name: null, avatarUrl: "" } } }), {
                    status: 200,
                    headers: {
                        "x-ratelimit-limit": "5000",
                        "x-ratelimit-remaining": "4999",
                        "x-ratelimit-reset": String(IN_AN_HOUR),
                        "x-ratelimit-resource": "graphql",
                    },
                })) as unknown as typeof fetch,
            { onRateLimit: (rateLimit) => seen.push(rateLimit.remaining) },
        );

        await github.getViewer("token");

        expect(seen).toEqual([4999]);
    });

    it("pauses background Inbox revalidation while the budget is low", async () => {
        const queryClient = createTestQueryClient();
        let fetches = 0;
        const observer = new QueryObserver(queryClient, {
            queryKey: queryKeys.inbox.section("quentin", "needs-your-review"),
            queryFn: async () => {
                fetches += 1;
                return fetches;
            },
            staleTime: Infinity,
        });
        const unsubscribe = observer.subscribe(() => {});
        await observer.refetch();
        const afterMount = fetches;

        recordGithubRateLimit(budget(100));
        revalidateInboxInBackground(queryClient, "quentin", null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fetches).toBe(afterMount);

        resetGithubRateLimit();
        revalidateInboxInBackground(queryClient, "quentin", null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fetches).toBe(afterMount + 1);

        unsubscribe();
    });
});
