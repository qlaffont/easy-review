import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { RepoStackIndexQueryData } from "#/lib/query/types.ts";
import type { PullRequestDetailQueryData } from "#/lib/query/types.ts";
import type { PullRequestStackState } from "#/lib/session/session.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { mergePullRequestSummaries } from "#/lib/query/inbox-fetch.ts";
import { getInboxQueryData } from "#/lib/query/inbox.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { resolvePullRequestStack, type ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import { pullRequestKey } from "#/lib/session/session.ts";
import { areStacksEnabled, getStackPreferences } from "#/lib/stack-preferences.ts";

async function fetchRepoStackIndex(
    session: ReturnType<typeof useSession>,
    repository: string,
    signal?: AbortSignal,
): Promise<RepoStackIndexQueryData> {
    void signal;
    const index = await session.github.listRepositoryStackIndex(session.requireToken(), repository);
    const login = session.state.state.auth.viewer?.login ?? "";
    const inboxForRepo = (getInboxQueryData(session.queryClient, login)?.pullRequests ?? []).filter(
        (pullRequest) => pullRequest.repository === repository,
    );
    return {
        pullRequests: mergePullRequestSummaries(index.pullRequests, inboxForRepo),
        defaultBranch: index.defaultBranch,
        lastLoadedAt: new Date().toISOString(),
    };
}

export function useRepoStackIndexQuery(repository: string) {
    const session = useSession();
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.repository.stackIndex(repository),
        queryFn: ({ signal }) => fetchRepoStackIndex(session, repository, signal),
        enabled: Boolean(login) && areStacksEnabled(),
        staleTime: CACHE_POLICY.repository.stackIndex.staleTime,
        gcTime: CACHE_POLICY.repository.stackIndex.gcTime,
        placeholderData: (previous) => previous,
    });

    return {
        status:
            query.isLoading && !query.data
                ? ("loading" as const)
                : query.isError
                  ? ("error" as const)
                  : query.data
                    ? ("ready" as const)
                    : ("idle" as const),
        pullRequests: query.data?.pullRequests ?? [],
        defaultBranch: query.data?.defaultBranch ?? null,
        error: query.isError ? query.error : null,
        lastLoadedAt: query.data?.lastLoadedAt ?? null,
        isFetching: query.isFetching,
        refetch: query.refetch,
    };
}

function loadedSummariesFromQueries(
    session: ReturnType<typeof useSession>,
    repository: string,
    indexPullRequests: Array<PullRequestSummary>,
): Array<PullRequestSummary> {
    const login = session.state.state.auth.viewer?.login ?? "";
    const inboxForRepo = (getInboxQueryData(session.queryClient, login)?.pullRequests ?? []).filter(
        (pullRequest) => pullRequest.repository === repository,
    );
    const loadedFromDetails = session.queryClient
        .getQueriesData<PullRequestDetailQueryData>({ queryKey: ["pullRequest"] })
        .flatMap(([, data]) => {
            const detail = data?.detail;
            return detail?.repository === repository ? [detail] : [];
        });

    return mergePullRequestSummaries(mergePullRequestSummaries(indexPullRequests, inboxForRepo), loadedFromDetails);
}

export function usePullRequestStackQuery(
    repository: string,
    number: number,
): PullRequestStackState & { loadGraphite: () => Promise<void> } {
    const session = useSession();
    const index = useRepoStackIndexQuery(repository);
    const override = useSessionState(
        (state) => state.pullRequestStackOverrides[pullRequestKey(repository, number)] ?? null,
    );

    const pullRequests = useMemo(
        () => loadedSummariesFromQueries(session, repository, index.pullRequests),
        [session, repository, index.pullRequests],
    );

    const branchStack = useMemo((): ResolvedPullRequestStack | null => {
        if (!areStacksEnabled()) return null;
        const { hideClosed } = getStackPreferences();
        return resolvePullRequestStack({
            repository,
            number,
            pullRequests,
            defaultBranch: index.defaultBranch,
            hideClosed,
        });
    }, [repository, number, pullRequests, index.defaultBranch]);

    const stackState = useMemo((): PullRequestStackState => {
        if (!areStacksEnabled()) {
            return { status: "idle", stack: null, error: null };
        }
        if (index.status !== "ready" && index.status !== "error") {
            return { status: "loading", stack: null, error: null };
        }
        if (branchStack) {
            return { status: "ready", stack: branchStack, error: null };
        }
        if (override?.status === "loading") {
            return { status: "loading", stack: null, error: null };
        }
        if (override?.stack) {
            return { status: "ready", stack: override.stack, error: override.error };
        }
        if (override) {
            return override;
        }
        return { status: "loading", stack: null, error: null };
    }, [index.status, branchStack, override]);

    const loadGraphite = async () => {
        await session.loadGraphiteStack(repository, number);
    };

    return { ...stackState, loadGraphite };
}
