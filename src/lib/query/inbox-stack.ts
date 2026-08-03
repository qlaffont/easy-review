import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { mergePullRequestSummaries } from "#/lib/query/inbox-fetch.ts";
import { useInboxPullRequests } from "#/lib/query/inbox.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { resolvePullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import { areStacksEnabled, getStackPreferences } from "#/lib/stack-preferences.ts";

export type InboxStackBadge = {
    position: number;
    total: number;
};

/** Stack position badges for inbox rows, keyed by pull request key. */
export function useInboxStackBadges(pullRequests: ReadonlyArray<PullRequestSummary>): Map<string, InboxStackBadge> {
    const session = useSession();
    const inboxPullRequests = useInboxPullRequests();
    const stacksEnabled = areStacksEnabled();
    const { hideClosed } = getStackPreferences();

    const repositories = useMemo(
        () => [...new Set(pullRequests.map((pullRequest) => pullRequest.repository))],
        [pullRequests],
    );

    const indexQueries = useQueries({
        queries: repositories.map((repository) => ({
            queryKey: queryKeys.repository.stackIndex(repository),
            queryFn: async () => {
                const index = await session.github.listRepositoryStackIndex(session.requireToken(), repository);
                const inboxForRepo = inboxPullRequests.filter((pullRequest) => pullRequest.repository === repository);
                return {
                    pullRequests: mergePullRequestSummaries(index.pullRequests, inboxForRepo),
                    defaultBranch: index.defaultBranch,
                };
            },
            enabled: stacksEnabled && repositories.length > 0,
            staleTime: CACHE_POLICY.repository.stackIndex.staleTime,
            gcTime: CACHE_POLICY.repository.stackIndex.gcTime,
            placeholderData: (
                previous: { pullRequests: Array<PullRequestSummary>; defaultBranch: string | null } | undefined,
            ) => previous,
        })),
    });

    return useMemo(() => {
        const badges = new Map<string, InboxStackBadge>();
        if (!stacksEnabled) {
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
            }
        }

        return badges;
    }, [stacksEnabled, hideClosed, pullRequests, repositories, indexQueries]);
}
