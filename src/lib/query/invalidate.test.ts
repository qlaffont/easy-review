import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidatePullRequestForManualRefresh } from "#/lib/query/invalidate.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { pullRequestKey } from "#/lib/session/session.ts";
import { createTestQueryClient } from "#/lib/session/testing/test-query-client.ts";

describe("invalidatePullRequestForManualRefresh", () => {
    it("refetches every active resource for the pull request", async () => {
        const queryClient = createTestQueryClient();
        const key = pullRequestKey("acme/api", 1);
        const resourceKeys = [
            queryKeys.pullRequest.detail(key),
            queryKeys.pullRequest.files(key),
            queryKeys.pullRequest.threads(key),
            queryKeys.pullRequest.conversation(key),
        ];
        const calls = new Map<string, number>();
        const observers = resourceKeys.map((queryKey) => {
            const resource = String(queryKey.at(-1));
            return new QueryObserver(queryClient, {
                queryKey,
                queryFn: async () => {
                    calls.set(resource, (calls.get(resource) ?? 0) + 1);
                    return { resource };
                },
            });
        });
        const unsubscribe = observers.map((observer) => observer.subscribe(() => undefined));

        await Promise.all(observers.map((observer) => observer.refetch()));
        queryClient.setQueryData(queryKeys.pullRequest.diff(key, "src/a.ts"), { diff: "cached" });

        await invalidatePullRequestForManualRefresh(queryClient, "acme/api", 1);

        expect(Object.fromEntries(calls)).toEqual({ detail: 2, files: 2, threads: 2, conversation: 2 });
        expect(queryClient.getQueryData(queryKeys.pullRequest.diff(key, "src/a.ts"))).toBeUndefined();
        unsubscribe.forEach((stop) => stop());
    });
});
