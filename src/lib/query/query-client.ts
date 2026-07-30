import { QueryClient } from "@tanstack/react-query";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";

/** Default cache policy for GitHub data — stale windows avoid redundant API calls. */
export function createAppQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: CACHE_POLICY.default.staleTime,
                gcTime: CACHE_POLICY.default.gcTime,
                retry: (failureCount, error) => {
                    const kind = (error as { kind?: string } | undefined)?.kind;
                    if (kind === "rate-limited" || kind === "unauthorized") {
                        return false;
                    }
                    return failureCount < 1;
                },
                refetchOnWindowFocus: false,
                refetchOnReconnect: true,
                /** Refetch on mount only when stale — pairs with per-query staleTime. */
                refetchOnMount: true,
            },
        },
    });
}
