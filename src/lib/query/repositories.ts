import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type { RepositoriesQueryData } from "#/lib/query/types.ts";
import type { EasyReviewSession } from "#/lib/session/session.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { useSession } from "#/lib/session/provider.tsx";

async function fetchRepositories(session: EasyReviewSession, signal?: AbortSignal): Promise<RepositoriesQueryData> {
    void signal;
    const available = await session.github.listRepositories(session.requireToken());
    return { available, lastLoadedAt: new Date().toISOString() };
}

export function useRepositoriesQuery() {
    const session = useSession();
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.repos.list(login),
        queryFn: ({ signal }) => fetchRepositories(session, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.repos.staleTime,
        gcTime: CACHE_POLICY.repos.gcTime,
        placeholderData: (previous) => previous,
    });

    const refresh = useCallback(async () => {
        await session.queryClient.invalidateQueries({ queryKey: queryKeys.repos.list(login), refetchType: "active" });
    }, [session.queryClient, login]);

    return {
        available: query.data?.available ?? [],
        lastLoadedAt: query.data?.lastLoadedAt ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isError: query.isError,
        error: query.error,
        refresh,
    };
}
