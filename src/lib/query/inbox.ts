import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { InboxQueryData } from "#/lib/query/types.ts";
import type { EasyReviewSession } from "#/lib/session/session.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { fetchInboxSections, emptyInboxQueryData } from "#/lib/query/inbox-fetch.ts";
import { revalidateInboxInBackground, invalidateInboxForRefresh } from "#/lib/query/invalidate.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { EasyReviewError } from "#/lib/session/errors.ts";
import { inboxSectionsFromLoaded, visibleSectionDefinitions } from "#/lib/session/inbox-sections.ts";
import { useSession } from "#/lib/session/provider.tsx";

export function inboxQueryKey(login: string) {
    return queryKeys.inbox.sections(login);
}

export function getInboxQueryData(queryClient: QueryClient, login: string): InboxQueryData | undefined {
    return queryClient.getQueryData(inboxQueryKey(login));
}

export function setInboxQueryData(
    queryClient: QueryClient,
    login: string,
    updater: InboxQueryData | ((previous: InboxQueryData | undefined) => InboxQueryData),
): InboxQueryData {
    const key = inboxQueryKey(login);
    queryClient.setQueryData(key, updater);
    return queryClient.getQueryData(key) ?? emptyInboxQueryData();
}

async function fetchInboxForSession(session: EasyReviewSession, signal?: AbortSignal): Promise<InboxQueryData> {
    const { auth, repos, inbox } = session.state.state;
    const viewerLogin = auth.viewer?.login;

    if (!viewerLogin || repos.selected.length === 0) {
        return emptyInboxQueryData();
    }

    const existing = getInboxQueryData(session.queryClient, viewerLogin) ?? emptyInboxQueryData();

    const { data, successes, failure } = await fetchInboxSections({
        github: session.github,
        token: session.requireToken(),
        viewerLogin,
        selected: repos.selected,
        sectionLayout: inbox.sectionLayout,
        existing,
        signal,
    });

    if (successes === 0 && failure) {
        throw new EasyReviewError(failure.kind, failure.message, { retryAt: failure.retryAt });
    }

    return data;
}

export function useInboxQuery() {
    const session = useSession();
    const queryClient = useQueryClient();
    const login = session.state.state.auth.viewer?.login ?? "";
    const selected = session.state.state.repos.selected;
    const sectionLayout = session.state.state.inbox.sectionLayout;
    const key = inboxQueryKey(login);

    const query = useQuery({
        queryKey: key,
        queryFn: ({ signal }) => fetchInboxForSession(session, signal),
        enabled: Boolean(login) && selected.length > 0,
        staleTime: CACHE_POLICY.inbox.staleTime,
        gcTime: CACHE_POLICY.inbox.gcTime,
        placeholderData: (previous) => previous,
    });

    const selectedSet = new Set(selected);
    const filteredSectionPullRequests = Object.fromEntries(
        Object.entries(query.data?.sectionPullRequests ?? {}).map(([sectionId, pullRequests]) => [
            sectionId,
            pullRequests.filter((pullRequest) => selectedSet.has(pullRequest.repository)),
        ]),
    );

    const sections = inboxSectionsFromLoaded(
        visibleSectionDefinitions(sectionLayout),
        filteredSectionPullRequests,
        query.data?.sectionCounts ?? {},
    );

    const refresh = useCallback(async () => {
        await invalidateInboxForRefresh(queryClient, login);
    }, [queryClient, login]);

    const revalidate = useCallback(
        async (options?: { background?: boolean }) => {
            if (options?.background) {
                revalidateInboxInBackground(queryClient, login, query.data?.lastLoadedAt);
                return;
            }
            await invalidateInboxForRefresh(queryClient, login);
        },
        [queryClient, login, query.data?.lastLoadedAt],
    );

    const invalidate = useCallback(() => {
        void invalidateInboxForRefresh(queryClient, login);
    }, [queryClient, login]);

    return {
        data: query.data,
        sections,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isError: query.isError,
        error: query.error,
        refresh,
        revalidate,
        invalidate,
    };
}

export function useInboxPullRequests(): Array<import("#/lib/session/types.ts").PullRequestSummary> {
    const session = useSession();
    const { data } = useInboxQuery();
    const selected = new Set(session.state.state.repos.selected);
    return (data?.pullRequests ?? []).filter((pullRequest) => selected.has(pullRequest.repository));
}
