import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type {
    ConversationQueryData,
    FileDiffQueryData,
    PullRequestCommitsQueryData,
    PullRequestDetailQueryData,
    PullRequestFilesQueryData,
    RelatedPullRequestsQueryData,
    RepositoryMetadataQueryData,
    ReviewThreadsQueryData,
} from "#/lib/query/types.ts";
import type {
    ConversationCommentsState,
    FileDiffState,
    FilesListState,
    PullRequestCommitsState,
    PullRequestPage,
    RelatedPullRequestsState,
    RepositoryMetadataState,
    ReviewThreadsState,
} from "#/lib/session/session.ts";
import type { PullRequestDetail, PullRequestSummary } from "#/lib/session/types.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { getInboxQueryData } from "#/lib/query/inbox.ts";
import {
    invalidatePullRequestDetailForCheckPoll,
    invalidatePullRequestForManualRefresh,
    revalidatePullRequestDetailForCheckPoll,
    revalidatePullRequestDetailInBackground,
} from "#/lib/query/invalidate.ts";
import {
    fetchConversation,
    fetchFileDiff,
    fetchPullRequestCommits,
    fetchPullRequestDetail,
    fetchPullRequestFiles,
    fetchRelatedPullRequests,
    fetchRepositoryMetadata,
    fetchReviewThreads,
    sessionErrorFromUnknown,
} from "#/lib/query/pull-request-fetch.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { toSessionError } from "#/lib/session/errors.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { pullRequestKey } from "#/lib/session/session.ts";

function prKey(repository: string, number: number) {
    return pullRequestKey(repository, number);
}

function queryStatus<T>(
    query: { isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown; data: T | undefined },
    hasData: boolean,
): "idle" | "loading" | "ready" | "error" {
    if (query.isError && !hasData) return "error";
    if (query.isLoading && !hasData) return "loading";
    if (hasData) return "ready";
    return "idle";
}

function toFilesListState(query: ReturnType<typeof useQuery<PullRequestFilesQueryData>>): FilesListState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        refreshing: query.isFetching && hasData,
        items: query.data?.items ?? [],
        error: query.isError ? toSessionError(query.error) : null,
        lastLoadedAt: query.data?.lastLoadedAt ?? null,
    };
}

function toFileDiffState(query: ReturnType<typeof useQuery<FileDiffQueryData>>): FileDiffState {
    const hasData = Boolean(query.data?.diff);
    return {
        status: queryStatus(query, hasData),
        refreshing: query.isFetching && hasData,
        diff: query.data?.diff ?? null,
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toThreadsState(query: ReturnType<typeof useQuery<ReviewThreadsQueryData>>): ReviewThreadsState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        items: query.data?.items ?? [],
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toConversationState(query: ReturnType<typeof useQuery<ConversationQueryData>>): ConversationCommentsState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        items: query.data?.items ?? [],
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toCommitsState(query: ReturnType<typeof useQuery<PullRequestCommitsQueryData>>): PullRequestCommitsState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        items: query.data?.items ?? [],
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toRelatedState(query: ReturnType<typeof useQuery<RelatedPullRequestsQueryData>>): RelatedPullRequestsState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        items: query.data?.items ?? [],
        headRefName: query.data?.headRefName ?? null,
        baseRefName: query.data?.baseRefName ?? null,
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toMetadataState(query: ReturnType<typeof useQuery<RepositoryMetadataQueryData>>): RepositoryMetadataState {
    const hasData = Boolean(query.data);
    return {
        status: queryStatus(query, hasData),
        users: query.data?.users ?? [],
        labels: query.data?.labels ?? [],
        error: query.isError ? toSessionError(query.error) : null,
    };
}

function toSummary(detail: PullRequestDetail): PullRequestSummary {
    return {
        key: detail.key,
        repository: detail.repository,
        number: detail.number,
        title: detail.title,
        url: detail.url,
        author: detail.author,
        authorAvatarUrl: detail.authorAvatarUrl,
        state: detail.state,
        isDraft: detail.isDraft,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        mergedAt: detail.mergedAt,
        headRefName: detail.headRefName,
        baseRefName: detail.baseRefName,
        reviewDecision: detail.reviewDecision,
        reviewRequests: detail.reviewRequests,
        reviewers: detail.reviewers,
        checks: detail.checks,
        additions: detail.additions,
        deletions: detail.deletions,
        changedFiles: detail.changedFiles,
        commentCount: detail.commentCount,
        mergeable: detail.mergeable,
        mergeStateStatus: detail.mergeStateStatus,
        assignees: detail.assignees,
        labels: detail.labels,
    };
}

export function usePullRequestQuery(repository: string, number: number) {
    const session = useSession();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.pullRequest.detail(key),
        queryFn: ({ signal }) => fetchPullRequestDetail(session, repository, number, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.pullRequest.detail.staleTime,
        gcTime: CACHE_POLICY.pullRequest.detail.gcTime,
        placeholderData: (previous) => previous,
    });

    const inboxSummary = getInboxQueryData(session.queryClient, login)?.pullRequests.find(
        (pullRequest) => pullRequest.key === key,
    );

    const refresh = useCallback(() => {
        invalidatePullRequestDetailForCheckPoll(session.queryClient, repository, number);
        return Promise.resolve();
    }, [session.queryClient, repository, number]);

    const revalidateDetail = useCallback(
        (options?: { background?: boolean; checkPoll?: boolean }) => {
            const lastLoadedAt = query.data?.lastLoadedAt;
            if (options?.checkPoll) {
                revalidatePullRequestDetailForCheckPoll(session.queryClient, repository, number, lastLoadedAt);
                return Promise.resolve();
            }
            if (options?.background) {
                revalidatePullRequestDetailInBackground(session.queryClient, repository, number, lastLoadedAt);
                return Promise.resolve();
            }
            return session.queryClient.invalidateQueries({
                queryKey: queryKeys.pullRequest.detail(key),
                refetchType: "active",
            });
        },
        [session.queryClient, repository, number, query.data?.lastLoadedAt, key],
    );

    return {
        detail: query.data?.detail ?? null,
        summary: inboxSummary ?? (query.data?.detail ? toSummary(query.data.detail) : null),
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isError: query.isError,
        error: query.isError ? toSessionError(query.error) : null,
        lastLoadedAt: query.data?.lastLoadedAt ?? null,
        refresh,
        revalidateDetail,
    };
}

export function usePullRequestFilesQuery(repository: string, number: number) {
    const session = useSession();
    const queryClient = useQueryClient();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.pullRequest.files(key),
        queryFn: ({ signal }) => fetchPullRequestFiles(session, repository, number, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.pullRequest.files.staleTime,
        gcTime: CACHE_POLICY.pullRequest.files.gcTime,
        placeholderData: (previous) => previous,
    });

    const refresh = useCallback(async () => {
        await query.refetch();
        void queryClient.removeQueries({ queryKey: ["pullRequest", key, "diff"] });
    }, [query, queryClient, key]);

    return {
        files: toFilesListState(query),
        refresh,
        isFetching: query.isFetching,
    };
}

export function usePullRequestPage(
    repository: string,
    number: number,
): PullRequestPage & {
    refresh: () => Promise<void>;
    revalidateDetail: (options?: { background?: boolean; checkPoll?: boolean }) => Promise<unknown>;
} {
    const pr = usePullRequestQuery(repository, number);
    const filesQuery = usePullRequestFilesQuery(repository, number);
    const session = useSession();

    const hasPaint = Boolean(pr.detail || pr.summary);
    const status =
        pr.isLoading && !hasPaint ? "loading" : pr.isError && !hasPaint ? "error" : hasPaint ? "ready" : "idle";

    const refresh = useCallback(async () => {
        await invalidatePullRequestForManualRefresh(session.queryClient, repository, number);
    }, [session.queryClient, repository, number]);

    return useMemo(
        () => ({
            repository,
            number,
            status,
            refreshing: pr.isFetching || filesQuery.isFetching,
            detail: pr.detail,
            summary: pr.summary,
            error: pr.error,
            lastLoadedAt: pr.lastLoadedAt,
            files: filesQuery.files,
            diffs: {},
            refresh,
            revalidateDetail: pr.revalidateDetail,
        }),
        [repository, number, status, pr, filesQuery, refresh],
    );
}

export function useReviewThreadsQuery(repository: string, number: number) {
    const session = useSession();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.pullRequest.threads(key),
        queryFn: ({ signal }) => fetchReviewThreads(session, repository, number, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.pullRequest.threads.staleTime,
        gcTime: CACHE_POLICY.pullRequest.threads.gcTime,
        placeholderData: (previous) => previous,
    });

    return { ...toThreadsState(query), isFetching: query.isFetching, refetch: query.refetch };
}

export function useConversationQuery(repository: string, number: number) {
    const session = useSession();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.pullRequest.conversation(key),
        queryFn: ({ signal }) => fetchConversation(session, repository, number, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.pullRequest.conversation.staleTime,
        gcTime: CACHE_POLICY.pullRequest.conversation.gcTime,
        placeholderData: (previous) => previous,
    });

    return { ...toConversationState(query), isFetching: query.isFetching, refetch: query.refetch };
}

export function usePullRequestCommitsQuery(repository: string, number: number) {
    const session = useSession();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.pullRequest.commits(key),
        queryFn: ({ signal }) => fetchPullRequestCommits(session, repository, number, signal),
        enabled: Boolean(login),
        staleTime: CACHE_POLICY.pullRequest.commits.staleTime,
        gcTime: CACHE_POLICY.pullRequest.commits.gcTime,
        placeholderData: (previous) => previous,
    });

    return { ...toCommitsState(query), isFetching: query.isFetching, refetch: query.refetch };
}

export function useFileDiffQuery(
    repository: string,
    number: number,
    path: string | null,
    options?: { force?: boolean; enabled?: boolean },
) {
    const session = useSession();
    const queryClient = useQueryClient();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";

    const previousPath = useMemo(() => {
        if (!path) return null;
        const files = queryClient.getQueryData<PullRequestFilesQueryData>(queryKeys.pullRequest.files(key));
        return files?.items.find((file) => file.path === path)?.previousPath ?? null;
    }, [queryClient, key, path]);

    const query = useQuery({
        queryKey: queryKeys.pullRequest.diff(key, path ?? ""),
        queryFn: ({ signal }) =>
            fetchFileDiff(session, repository, number, path!, { force: options?.force, previousPath }, signal),
        enabled: Boolean(login && path && (options?.enabled ?? true)),
        staleTime: CACHE_POLICY.pullRequest.diff.staleTime,
        gcTime: CACHE_POLICY.pullRequest.diff.gcTime,
        placeholderData: (previousData, previousQuery) => {
            if (!path || !previousData || !previousQuery) {
                return undefined;
            }
            const previousPath = previousQuery.queryKey[3];
            if (previousPath !== path) {
                return undefined;
            }
            return previousData;
        },
    });

    const refresh = useCallback(async () => {
        if (!path) return;
        const data = await fetchFileDiff(session, repository, number, path, { force: true, previousPath });
        queryClient.setQueryData(queryKeys.pullRequest.diff(key, path), data);
    }, [session, repository, number, path, previousPath, queryClient, key]);

    return {
        ...toFileDiffState(query),
        isFetching: query.isFetching,
        refresh,
    };
}

export function useRelatedPullRequestsQuery(repository: string, number: number) {
    const session = useSession();
    const key = prKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";
    const pr = usePullRequestQuery(repository, number);

    const query = useQuery({
        queryKey: queryKeys.pullRequest.related(key),
        queryFn: ({ signal }) => fetchRelatedPullRequests(session, repository, number, signal),
        enabled: Boolean(login && (pr.detail || pr.summary)),
        staleTime: CACHE_POLICY.pullRequest.related.staleTime,
        gcTime: CACHE_POLICY.pullRequest.related.gcTime,
        placeholderData: (previous) => previous,
    });

    return { ...toRelatedState(query), isFetching: query.isFetching, refetch: query.refetch };
}

export function useRepositoryMetadataQuery(repository: string | null) {
    const session = useSession();
    const login = session.state.state.auth.viewer?.login ?? "";

    const query = useQuery({
        queryKey: queryKeys.repository.metadata(repository ?? ""),
        queryFn: ({ signal }) => fetchRepositoryMetadata(session, repository!, signal),
        enabled: Boolean(login && repository),
        staleTime: CACHE_POLICY.repository.metadata.staleTime,
        gcTime: CACHE_POLICY.repository.metadata.gcTime,
        placeholderData: (previous) => previous,
    });

    return {
        metadata: repository ? toMetadataState(query) : null,
        isFetching: query.isFetching,
        refetch: query.refetch,
    };
}

export function setPullRequestDetailQueryData(
    queryClient: ReturnType<typeof useQueryClient>,
    key: string,
    detail: PullRequestDetail,
): void {
    queryClient.setQueryData<PullRequestDetailQueryData>(queryKeys.pullRequest.detail(key), {
        detail,
        lastLoadedAt: new Date().toISOString(),
    });
}

export { sessionErrorFromUnknown };
