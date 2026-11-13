import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { InboxQueryData, InboxSectionQueryData } from "#/lib/query/types.ts";
import type { InboxSectionDefinition } from "#/lib/session/inbox-sections.ts";
import type { GithubClient } from "#/lib/session/ports.ts";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import {
    collapsedSilentSectionIds,
    countOnlySectionQueries,
    emptyInboxQueryData,
    fetchInboxSection,
    fetchSectionPool,
    mergeSectionResultsIntoInbox,
    type SectionCountLoader,
    type SectionPoolLoader,
} from "#/lib/query/inbox-fetch.ts";
import {
    revalidateInboxInBackground,
    invalidateInboxForRefresh,
    invalidateInboxSectionForRefresh,
} from "#/lib/query/invalidate.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { EasyReviewError, toSessionError } from "#/lib/session/errors.ts";
import { inboxSectionsFromLoaded, visibleSectionDefinitions } from "#/lib/session/inbox-sections.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { sectionPoolSearchQuery } from "#/lib/session/section-filters.ts";

export function inboxQueryKey(login: string) {
    return queryKeys.inbox.sections(login);
}

export function inboxSectionQueryKey(login: string, sectionId: string) {
    return queryKeys.inbox.section(login, sectionId);
}

export function inboxSectionQueryPrefix(login: string) {
    return ["inbox", "section", login] as const;
}

/** Shared section searches are reused this long, so sections loading together fetch them once. */
const INBOX_POOL_REUSE_MS = 10_000;

/**
 * Section pool loader backed by the query cache: concurrent sections share one in-flight load, and
 * any section invalidation (refresh, revalidate, mutation) marks the pool stale with them.
 */
export function inboxPoolLoader(
    queryClient: QueryClient,
    params: { github: GithubClient; token: string; viewerLogin: string; selected: ReadonlyArray<string> },
): SectionPoolLoader {
    const { github, token, viewerLogin, selected } = params;
    const repositories = [...selected].sort().join(",");
    return (query) =>
        queryClient.fetchQuery({
            queryKey: queryKeys.inbox.pool(viewerLogin, repositories, query),
            queryFn: () => fetchSectionPool({ github, token, query, repositories: selected }),
            staleTime: INBOX_POOL_REUSE_MS,
            gcTime: CACHE_POLICY.inbox.staleTime,
            retry: false,
        });
}

/**
 * Count loader for the sections that only need a count: the first section to ask counts them all in
 * one GitHub request (see `countPullRequestsByQuery`), the others reuse that answer.
 */
export function inboxCountLoader(
    queryClient: QueryClient,
    params: {
        github: GithubClient;
        token: string;
        viewerLogin: string;
        selected: ReadonlyArray<string>;
        queries: Iterable<string>;
    },
): SectionCountLoader {
    const { github, token, viewerLogin, selected } = params;
    const repositories = [...selected].sort().join(",");
    const queries = [...new Set(params.queries)].sort();
    return async (query) => {
        const batch = queries.includes(query) ? queries : [query];
        const counts = await queryClient.fetchQuery({
            queryKey: queryKeys.inbox.pool(viewerLogin, repositories, `counts\n${batch.join("\n")}`),
            queryFn: () => github.countPullRequestsByQuery(token, { queries: batch, repositories: selected }),
            staleTime: INBOX_POOL_REUSE_MS,
            gcTime: CACHE_POLICY.inbox.staleTime,
            retry: false,
        });
        return counts[query] ?? 0;
    };
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

function sectionDataFromAggregate(
    aggregate: InboxQueryData | undefined,
    sectionId: string,
): InboxSectionQueryData | undefined {
    if (!aggregate?.sectionPullRequests[sectionId]) {
        return undefined;
    }

    return {
        sectionId,
        pullRequests: aggregate.sectionPullRequests[sectionId] ?? [],
        totalCount: aggregate.sectionCounts[sectionId] ?? 0,
        pageInfo: aggregate.sectionPagination[sectionId] ?? { hasNextPage: false, endCursor: null },
        lastLoadedAt: aggregate.lastLoadedAt,
    };
}

export async function fetchInboxSectionWithDeps(
    deps: {
        github: GithubClient;
        queryClient: QueryClient;
        requireToken: () => string;
        syncInboxData: (data: InboxQueryData) => void;
        viewerLogin: string;
        selected: ReadonlyArray<string>;
        /**
         * Collapsed, silent sections and the exact searches among them that a count answers
         * (read at fetch time: expand state moves).
         */
        collapsedSections?: () => { ids: ReadonlySet<string>; countQueries: Iterable<string> };
    },
    definition: InboxSectionDefinition,
    signal?: AbortSignal,
): Promise<InboxSectionQueryData> {
    const { github, queryClient, requireToken, syncInboxData, viewerLogin, selected } = deps;

    if (!viewerLogin || selected.length === 0) {
        return {
            sectionId: definition.id,
            pullRequests: [],
            totalCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            lastLoadedAt: null,
        };
    }

    const existing = getInboxQueryData(queryClient, viewerLogin) ?? emptyInboxQueryData();

    try {
        const token = requireToken();
        const collapsed = deps.collapsedSections?.();
        const result = await fetchInboxSection({
            github,
            token,
            viewerLogin,
            selected,
            definition,
            existing,
            signal,
            loadPool: inboxPoolLoader(queryClient, { github, token, viewerLogin, selected }),
            collapsed: collapsed?.ids.has(definition.id)
                ? {
                      loadCount: inboxCountLoader(queryClient, {
                          github,
                          token,
                          viewerLogin,
                          selected,
                          queries: collapsed.countQueries,
                      }),
                  }
                : undefined,
        });

        let merged = emptyInboxQueryData();
        setInboxQueryData(queryClient, viewerLogin, (current) => {
            merged = mergeSectionResultsIntoInbox(current ?? emptyInboxQueryData(), [result]);
            return merged;
        });
        syncInboxData(merged);

        return {
            sectionId: result.id,
            pullRequests: result.pullRequests,
            totalCount: result.totalCount,
            pageInfo: result.pageInfo,
            lastLoadedAt: merged.lastLoadedAt,
        };
    } catch (error) {
        const cached = sectionDataFromAggregate(existing, definition.id);
        if (cached) {
            return cached;
        }
        throw new EasyReviewError(toSessionError(error).kind, toSessionError(error).message, {
            retryAt: toSessionError(error).retryAt,
        });
    }
}

export function useInboxQuery() {
    const session = useSession();
    const queryClient = useQueryClient();
    const login = session.state.state.auth.viewer?.login ?? "";
    const selected = session.state.state.repos.selected;
    const sectionLayout = session.state.state.inbox.sectionLayout;
    const definitions = useMemo(() => visibleSectionDefinitions(sectionLayout), [sectionLayout]);

    const sectionFetchDeps = useMemo(
        () => ({
            github: session.github,
            queryClient,
            requireToken: () => session.requireToken(),
            syncInboxData: session.syncInboxData.bind(session),
            viewerLogin: login,
            selected,
            collapsedSections: () => {
                const { sectionLayout: layout, expandedSections } = session.state.state.inbox;
                return {
                    ids: collapsedSilentSectionIds(layout, expandedSections),
                    countQueries: countOnlySectionQueries(layout, expandedSections, login).values(),
                };
            },
        }),
        [session, queryClient, login, selected],
    );

    const sectionQueries = useQueries({
        queries: definitions.map((definition) => ({
            queryKey: inboxSectionQueryKey(login, definition.id),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
                fetchInboxSectionWithDeps(sectionFetchDeps, definition, signal),
            enabled: Boolean(login) && selected.length > 0,
            staleTime: CACHE_POLICY.inbox.staleTime,
            gcTime: CACHE_POLICY.inbox.gcTime,
            placeholderData: (previous: InboxSectionQueryData | undefined) =>
                previous ?? sectionDataFromAggregate(getInboxQueryData(queryClient, login), definition.id),
        })),
    });

    const data = getInboxQueryData(queryClient, login) ?? emptyInboxQueryData();

    const sectionFetching = useMemo(
        () =>
            Object.fromEntries(
                definitions.map((definition, index) => [definition.id, sectionQueries[index]?.isFetching ?? false]),
            ),
        [definitions, sectionQueries],
    );

    const sectionErrors = useMemo(
        () =>
            Object.fromEntries(
                definitions.map((definition, index) => {
                    const query = sectionQueries[index];
                    if (!query?.isError || !query.error) {
                        return [definition.id, null];
                    }
                    return [definition.id, query.error instanceof Error ? query.error.message : "Could not load."];
                }),
            ),
        [definitions, sectionQueries],
    );

    const isLoading = sectionQueries.some((query) => query.isLoading && !query.data);
    const isFetching = sectionQueries.some((query) => query.isFetching);
    const isError = sectionQueries.every((query) => query.isError) && !data.pullRequests.length;
    const error = sectionQueries.find((query) => query.error)?.error ?? null;

    const selectedSet = new Set(selected);
    const filteredSectionPullRequests = Object.fromEntries(
        Object.entries(data.sectionPullRequests).map(([sectionId, pullRequests]) => [
            sectionId,
            pullRequests.filter((pullRequest) => selectedSet.has(pullRequest.repository)),
        ]),
    );

    const sections = inboxSectionsFromLoaded(definitions, filteredSectionPullRequests, data.sectionCounts);

    const refresh = useCallback(async () => {
        // A long-lived tab can retain an in-memory credential after GitHub has
        // invalidated its cookie. Re-probe first so a manual refresh follows the
        // same OAuth reconnect path as a full page reload.
        await session.restore();
        if (!session.state.state.auth.viewer) {
            return;
        }
        await invalidateInboxForRefresh(queryClient, login);
    }, [session, queryClient, login]);

    const refreshSection = useCallback(
        async (sectionId: string) => {
            const definition = definitions.find((entry) => entry.id === sectionId);
            const pool = definition ? sectionPoolSearchQuery(definition.filter, login) : null;
            if (!pool) {
                await invalidateInboxSectionForRefresh(queryClient, login, sectionId);
                return;
            }

            // Sections sharing this search reload together: one fetch, consistent rows.
            await queryClient.invalidateQueries({ queryKey: queryKeys.inbox.pools(login), refetchType: "none" });
            await Promise.all(
                definitions
                    .filter((entry) => sectionPoolSearchQuery(entry.filter, login) === pool)
                    .map((entry) => invalidateInboxSectionForRefresh(queryClient, login, entry.id)),
            );
        },
        [queryClient, login, definitions],
    );

    const revalidate = useCallback(
        async (options?: { background?: boolean }) => {
            if (options?.background) {
                revalidateInboxInBackground(queryClient, login, data.lastLoadedAt);
                return;
            }
            await invalidateInboxForRefresh(queryClient, login);
        },
        [queryClient, login, data.lastLoadedAt],
    );

    const invalidate = useCallback(() => {
        void invalidateInboxForRefresh(queryClient, login);
    }, [queryClient, login]);

    return {
        data,
        sections,
        sectionFetching,
        sectionErrors,
        isLoading,
        isFetching,
        isError,
        error,
        refresh,
        refreshSection,
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
