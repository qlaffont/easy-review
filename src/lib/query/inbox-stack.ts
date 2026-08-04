import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PullRequestStackQueryData } from "#/lib/query/types.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { fetchRepoStackIndex } from "#/lib/query/stack.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { resolvePullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import { getStackPreferences, useStackPreferences } from "#/lib/stack-preferences.ts";

export type InboxStackBadge = {
    position: number;
    total: number;
};

/** Stack position badges for inbox rows, keyed by pull request key. */
export function useInboxStackBadges(pullRequests: ReadonlyArray<PullRequestSummary>): Map<string, InboxStackBadge> {
    const session = useSession();
    const [stackPreferences] = useStackPreferences();
    const { hideClosed } = getStackPreferences();

    const repositories = useMemo(
        () => [...new Set(pullRequests.map((pullRequest) => pullRequest.repository))],
        [pullRequests],
    );

    const indexQueries = useQueries({
        queries: repositories.map((repository) => ({
            queryKey: queryKeys.repository.stackIndex(repository),
            queryFn: ({ signal }: { signal: AbortSignal }) => fetchRepoStackIndex(session, repository, signal),
            enabled: stackPreferences.enabled && repositories.length > 0,
            staleTime: CACHE_POLICY.repository.stackIndex.staleTime,
            gcTime: CACHE_POLICY.repository.stackIndex.gcTime,
            placeholderData: (previous: Awaited<ReturnType<typeof fetchRepoStackIndex>> | undefined) => previous,
        })),
    });

    return useMemo(() => {
        const badges = new Map<string, InboxStackBadge>();
        if (!stackPreferences.enabled) {
            return badges;
        }

        const indexByRepo = new Map(
            repositories.map((repository, index) => [repository, indexQueries[index]?.data] as const),
        );

        for (const pullRequest of pullRequests) {
            const index = indexByRepo.get(pullRequest.repository);
            if (!index) {
                continue;
            }

            const stack = resolvePullRequestStack({
                repository: pullRequest.repository,
                number: pullRequest.number,
                pullRequests: index.pullRequests,
                defaultBranch: index.defaultBranch,
                hideClosed,
            });

            if (stack && stack.total > 1) {
                badges.set(pullRequest.key, { position: stack.position, total: stack.total });
                continue;
            }

            const cachedStack = session.queryClient.getQueryData<PullRequestStackQueryData>(
                queryKeys.pullRequest.stack(pullRequest.key),
            );
            if (cachedStack?.stack && cachedStack.stack.total > 1) {
                badges.set(pullRequest.key, {
                    position: cachedStack.stack.position,
                    total: cachedStack.stack.total,
                });
            }
        }

        return badges;
    }, [stackPreferences.enabled, hideClosed, pullRequests, repositories, indexQueries, session.queryClient]);
}
