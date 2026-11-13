import type { InboxFetchResult, InboxQueryData, InboxSectionFetchScope } from "#/lib/query/types.ts";
import type { GithubClient, InboxPullRequestPageInfo } from "#/lib/session/ports.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { EasyReviewError, toSessionError } from "#/lib/session/errors.ts";
import {
    INBOX_SECTION_LOAD_SIZE,
    visibleSectionDefinitions,
    allSectionDefinitions,
    type InboxSectionDefinition,
    type InboxSectionId,
    type InboxSectionLayoutEntry,
} from "#/lib/session/inbox-sections.ts";
import { comparePullRequestsByUpdatedAtDesc } from "#/lib/session/pull-request-search.ts";
import {
    matchSectionFilter,
    sectionFilterNeedsClientFilter,
    sectionFilterToSearchQuery,
    sectionPoolSearchQuery,
    type SectionFilter,
} from "#/lib/session/section-filters.ts";

const INBOX_SECTION_FETCH_CONCURRENCY = 4;

function mergePullRequestSummary(previous: PullRequestSummary, incoming: PullRequestSummary): PullRequestSummary {
    const needsHydration = (pullRequest: PullRequestSummary) =>
        pullRequest.reviewers.length === 0 &&
        pullRequest.reviewRequests.length === 0 &&
        pullRequest.checks === "none" &&
        pullRequest.commentCount === 0 &&
        pullRequest.reviewDecision === null &&
        pullRequest.mergeable === "unknown";

    if (!needsHydration(incoming) && !needsHydration(previous)) {
        return Date.parse(incoming.updatedAt) >= Date.parse(previous.updatedAt) ? incoming : previous;
    }

    if (!needsHydration(incoming)) {
        return incoming;
    }

    return {
        ...incoming,
        reviewers: previous.reviewers.length > 0 ? previous.reviewers : incoming.reviewers,
        reviewRequests: previous.reviewRequests.length > 0 ? previous.reviewRequests : incoming.reviewRequests,
        checks: previous.checks !== "none" ? previous.checks : incoming.checks,
        commentCount: previous.commentCount > 0 ? previous.commentCount : incoming.commentCount,
        reviewDecision: previous.reviewDecision ?? incoming.reviewDecision,
        mergeable: previous.mergeable !== "unknown" ? previous.mergeable : incoming.mergeable,
        mergeStateStatus:
            previous.mergeStateStatus !== "unknown" ? previous.mergeStateStatus : incoming.mergeStateStatus,
        assignees: previous.assignees.length > 0 ? previous.assignees : incoming.assignees,
        labels: previous.labels.length > 0 ? previous.labels : incoming.labels,
        githubStack: incoming.githubStack ?? previous.githubStack ?? null,
    };
}

export function mergePullRequestSummaries(
    existing: ReadonlyArray<PullRequestSummary>,
    incoming: ReadonlyArray<PullRequestSummary>,
): Array<PullRequestSummary> {
    const byKey = new Map(existing.map((pullRequest) => [pullRequest.key, pullRequest]));
    for (const pullRequest of incoming) {
        const previous = byKey.get(pullRequest.key);
        byKey.set(pullRequest.key, previous ? mergePullRequestSummary(previous, pullRequest) : pullRequest);
    }
    return [...byKey.values()];
}

function isRateLimitedError(error: unknown): boolean {
    return error instanceof EasyReviewError
        ? error.kind === "rate-limited"
        : toSessionError(error).kind === "rate-limited";
}

export function emptyInboxQueryData(): InboxQueryData {
    return {
        pullRequests: [],
        sectionPullRequests: {},
        sectionCounts: {},
        sectionPagination: {},
        lastLoadedAt: null,
    };
}

export type SectionFetchResult = {
    id: InboxSectionId;
    pullRequests: Array<PullRequestSummary>;
    totalCount: number;
    pageInfo: InboxPullRequestPageInfo;
};

export function mergeSectionResultsIntoInbox(
    existing: InboxQueryData,
    results: ReadonlyArray<SectionFetchResult>,
): InboxQueryData {
    const sectionPullRequests = { ...existing.sectionPullRequests };
    const sectionCounts = { ...existing.sectionCounts };
    const sectionPagination = { ...existing.sectionPagination };
    let mergedPool = [...existing.pullRequests];

    for (const result of results) {
        sectionPullRequests[result.id] = result.pullRequests;
        sectionCounts[result.id] = result.totalCount;
        sectionPagination[result.id] = result.pageInfo;
        mergedPool = mergePullRequestSummaries(mergedPool, result.pullRequests);
    }

    return {
        pullRequests: mergedPool,
        sectionPullRequests,
        sectionCounts,
        sectionPagination,
        lastLoadedAt: new Date().toISOString(),
    };
}

async function mapWithConcurrency<TItem, TResult>(
    items: ReadonlyArray<TItem>,
    concurrency: number,
    fn: (item: TItem) => Promise<TResult>,
): Promise<Array<TResult>> {
    if (items.length === 0) {
        return [];
    }

    const results: Array<TResult> = Array.from({ length: items.length });
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await fn(items[index]!);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

    return results;
}

/**
 * Rows per search page when every row must come back. GitHub charges about one hundredth of a point
 * per connection asked for: a row brings 5 (reviews, review requests, labels, assignees, last commit),
 * so 39 rows cost 1 + 39 × 5 = 196 → 2 points, where 50 cost 3 (measured).
 */
export const FULL_LIST_PAGE_SIZE = 39;
/** Pages of a shared section search: beyond this many rows, sections search on their own. */
const SECTION_POOL_MAX_PAGES = 3;

/** Every pull request behind a shared section search, and whether GitHub had no more. */
export type SectionPool = {
    pullRequests: Array<PullRequestSummary>;
    complete: boolean;
};

export type SectionPoolLoader = (query: string) => Promise<SectionPool>;

async function pageThroughSearch(params: {
    github: GithubClient;
    token: string;
    query: string;
    repositories: ReadonlyArray<string>;
    allRepositories: boolean;
}): Promise<SectionPool> {
    const { github, token, query, repositories, allRepositories } = params;
    let pullRequests: Array<PullRequestSummary> = [];
    let after: string | null = null;

    for (let page = 0; page < SECTION_POOL_MAX_PAGES; page += 1) {
        const result = await github.fetchSectionPullRequests(token, {
            query,
            repositories: [...repositories],
            allRepositories,
            limit: FULL_LIST_PAGE_SIZE,
            after,
        });
        pullRequests = mergePullRequestSummaries(pullRequests, result.pullRequests);

        if (!result.pageInfo.hasNextPage) {
            return { pullRequests, complete: true };
        }
        if (!result.pageInfo.endCursor || result.pullRequests.length === 0) {
            break;
        }
        after = result.pageInfo.endCursor;
    }

    return { pullRequests, complete: false };
}

/**
 * Load a shared section search in full. It is already narrowed to the viewer, so it first runs
 * across every repository (one request, however long the allowlist) and keeps the allowlisted rows;
 * only when that is too long to load does it page through the allowlist-scoped search instead.
 */
export async function fetchSectionPool(params: {
    github: GithubClient;
    token: string;
    query: string;
    repositories: ReadonlyArray<string>;
}): Promise<SectionPool> {
    const allowed = new Set(params.repositories);
    const everywhere = await pageThroughSearch({ ...params, allRepositories: true });
    if (everywhere.complete) {
        return {
            pullRequests: everywhere.pullRequests.filter((pullRequest) => allowed.has(pullRequest.repository)),
            complete: true,
        };
    }

    return pageThroughSearch({ ...params, allRepositories: false });
}

/** Counts several section searches at once; resolves one query's count. */
export type SectionCountLoader = (query: string) => Promise<number>;

/** Share one load per query between the sections asking for it in the same refresh. */
export function memoizeSectionPoolLoader(load: SectionPoolLoader): SectionPoolLoader {
    const loads = new Map<string, Promise<SectionPool>>();
    return (query) => {
        const existing = loads.get(query);
        if (existing) {
            return existing;
        }
        const started = load(query);
        loads.set(query, started);
        started.catch(() => loads.delete(query));
        return started;
    };
}

/** The section's search when GitHub applies its filter exactly, so `issueCount` is its count. */
export function exactSectionSearchQuery(filter: SectionFilter, viewerLogin: string): string | null {
    if (sectionFilterNeedsClientFilter(filter, viewerLogin)) {
        return null;
    }
    return sectionFilterToSearchQuery(filter, viewerLogin);
}

/**
 * Sections nobody is looking at: visible but collapsed, and without notifications (those must know
 * which pull requests entered). They load as little as their count allows.
 */
export function collapsedSilentSectionIds(
    layout: ReadonlyArray<InboxSectionLayoutEntry>,
    expandedSections: ReadonlyArray<InboxSectionId>,
): Set<InboxSectionId> {
    const expanded = new Set(expandedSections);
    return new Set(
        layout
            .filter((entry) => !entry.hidden && !expanded.has(entry.id) && !entry.notifyOnNewPullRequest)
            .map((entry) => entry.id),
    );
}

/**
 * Of the collapsed, silent sections, those GitHub search filters exactly: their count alone is
 * enough, and they are counted together. Keyed by section id.
 */
export function countOnlySectionQueries(
    layout: ReadonlyArray<InboxSectionLayoutEntry>,
    expandedSections: ReadonlyArray<InboxSectionId>,
    viewerLogin: string,
): Map<InboxSectionId, string> {
    const collapsed = collapsedSilentSectionIds(layout, expandedSections);
    const queries = new Map<InboxSectionId, string>();
    for (const entry of layout) {
        if (!collapsed.has(entry.id)) {
            continue;
        }
        const query = exactSectionSearchQuery(entry.filter, viewerLogin);
        if (query) {
            queries.set(entry.id, query);
        }
    }
    return queries;
}

/**
 * Load one inbox section: from a shared search when it has one (exact rows and count), else from
 * its own GitHub search, else from the cached pool when GitHub search cannot express the filter.
 */
export async function fetchInboxSection(params: {
    github: GithubClient;
    token: string;
    viewerLogin: string;
    selected: ReadonlyArray<string>;
    definition: InboxSectionDefinition;
    existing: InboxQueryData;
    signal?: AbortSignal;
    loadPool?: SectionPoolLoader;
    /**
     * Set when the section is collapsed and silent (no notifications). An exact search then loads
     * only its count; any other search loads small pages. Rows load fully when the section opens.
     */
    collapsed?: { loadCount: SectionCountLoader };
}): Promise<SectionFetchResult> {
    const { github, token, viewerLogin, selected, definition, existing, signal } = params;

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }

    const countQuery = params.collapsed ? exactSectionSearchQuery(definition.filter, viewerLogin) : null;
    if (countQuery && params.collapsed) {
        const count = await params.collapsed.loadCount(countQuery);
        return {
            id: definition.id,
            pullRequests: [],
            totalCount: count,
            pageInfo: { hasNextPage: count > 0, endCursor: null },
        };
    }

    const selectedSet = new Set(selected);
    const poolQuery = sectionPoolSearchQuery(definition.filter, viewerLogin);

    if (poolQuery) {
        const loadPool =
            params.loadPool ?? ((query: string) => fetchSectionPool({ github, token, query, repositories: selected }));
        const pool = await loadPool(poolQuery);

        if (pool.complete) {
            const matched = pool.pullRequests
                .filter(
                    (pullRequest) =>
                        selectedSet.has(pullRequest.repository) &&
                        matchSectionFilter(pullRequest, definition.filter, viewerLogin),
                )
                .sort(comparePullRequestsByUpdatedAtDesc);

            return {
                id: definition.id,
                pullRequests: matched,
                totalCount: matched.length,
                pageInfo: { hasNextPage: false, endCursor: null },
            };
        }
    }

    const query = sectionFilterToSearchQuery(definition.filter, viewerLogin);

    if (query) {
        const scan = await scanSectionSearch({
            github,
            token,
            query,
            repositories: selected,
            filter: definition.filter,
            viewerLogin,
            signal,
            compact: Boolean(params.collapsed),
        });

        return {
            id: definition.id,
            pullRequests: scan.pullRequests,
            totalCount: sectionCountAfterScan({
                upperBound: scan.githubTotal,
                dropped: scan.dropped,
                matchingLoaded: scan.pullRequests.length,
                hasNextPage: scan.pageInfo.hasNextPage,
            }),
            pageInfo: scan.pageInfo,
        };
    }

    const matched = existing.pullRequests
        .filter(
            (pullRequest) =>
                selectedSet.has(pullRequest.repository) &&
                matchSectionFilter(pullRequest, definition.filter, viewerLogin),
        )
        .sort(comparePullRequestsByUpdatedAtDesc);
    const pullRequests = matched.slice(0, INBOX_SECTION_LOAD_SIZE);

    return {
        id: definition.id,
        pullRequests,
        totalCount: matched.length,
        pageInfo: {
            hasNextPage: matched.length > pullRequests.length,
            endCursor: matched.length > pullRequests.length ? String(pullRequests.length) : null,
        },
    };
}

/**
 * Load inbox sections from GitHub. Always merges with `existing` so a partial refresh
 * never wipes sections that failed or were skipped (rate limit).
 */
export async function fetchInboxSections(params: {
    github: GithubClient;
    token: string;
    viewerLogin: string;
    selected: ReadonlyArray<string>;
    sectionLayout: ReadonlyArray<InboxSectionLayoutEntry>;
    existing: InboxQueryData;
    sectionIds?: InboxSectionFetchScope;
    signal?: AbortSignal;
    onSectionLoaded?: (result: SectionFetchResult) => void;
    /** Shared section searches; defaults to one load per query for this call. */
    loadPool?: SectionPoolLoader;
    /** Collapsed, silent sections, and the loader that counts the exact ones together. */
    collapsed?: { sectionIds: ReadonlySet<InboxSectionId>; loadCount: SectionCountLoader };
}): Promise<InboxFetchResult> {
    const { github, token, viewerLogin, selected, sectionLayout, existing, sectionIds, signal, onSectionLoaded } =
        params;
    const loadPool =
        params.loadPool ??
        memoizeSectionPoolLoader((query) => fetchSectionPool({ github, token, query, repositories: selected }));

    if (selected.length === 0) {
        return { data: emptyInboxQueryData(), successes: 0, failure: null };
    }

    const definitions: ReadonlyArray<InboxSectionDefinition> = sectionIds
        ? allSectionDefinitions(sectionLayout).filter((definition) => sectionIds.includes(definition.id))
        : visibleSectionDefinitions(sectionLayout);

    let failure: ReturnType<typeof toSessionError> | null = null;
    let stopFetching = false;

    const outcomes = await mapWithConcurrency(definitions, INBOX_SECTION_FETCH_CONCURRENCY, async (definition) => {
        if (stopFetching || signal?.aborted) {
            return null;
        }

        try {
            const result = await fetchInboxSection({
                github,
                token,
                viewerLogin,
                selected,
                definition,
                existing,
                signal,
                loadPool,
                collapsed: params.collapsed?.sectionIds.has(definition.id) ? params.collapsed : undefined,
            });
            onSectionLoaded?.(result);
            return result;
        } catch (error) {
            failure ??= toSessionError(error);
            if (isRateLimitedError(error)) {
                stopFetching = true;
            }
            return null;
        }
    });

    const successes = outcomes.filter((result): result is SectionFetchResult => result !== null).length;

    if (successes === 0) {
        return { data: existing, successes, failure };
    }

    const successful = outcomes.filter((result): result is SectionFetchResult => result !== null);

    return {
        data: mergeSectionResultsIntoInbox(existing, successful),
        successes,
        failure,
    };
}

export function patchInboxPullRequest(
    data: InboxQueryData,
    summary: PullRequestSummary,
    context: {
        viewerLogin: string;
        sections: ReadonlyArray<Pick<InboxSectionLayoutEntry, "id" | "filter">>;
    },
): InboxQueryData {
    const pullRequests = data.pullRequests.some((pullRequest) => pullRequest.key === summary.key)
        ? data.pullRequests.map((pullRequest) => (pullRequest.key === summary.key ? summary : pullRequest))
        : [...data.pullRequests, summary].sort(comparePullRequestsByUpdatedAtDesc);

    const sectionCounts = { ...data.sectionCounts };
    const sectionPullRequests = Object.fromEntries(
        context.sections.map((section) => {
            const existing = data.sectionPullRequests[section.id] ?? [];
            const wasInSection = existing.some((pullRequest) => pullRequest.key === summary.key);
            const without = existing.filter((pullRequest) => pullRequest.key !== summary.key);
            const matches = matchSectionFilter(summary, section.filter, context.viewerLogin);
            const next = matches ? [...without, summary].sort(comparePullRequestsByUpdatedAtDesc) : without;

            if (wasInSection && !matches && sectionCounts[section.id] != null) {
                sectionCounts[section.id] = Math.max(0, sectionCounts[section.id] - 1);
            }
            if (!wasInSection && matches && sectionCounts[section.id] != null) {
                sectionCounts[section.id] += 1;
            }

            return [section.id, next];
        }),
    );

    return { ...data, pullRequests, sectionPullRequests, sectionCounts };
}

/**
 * Pages one fetch may scan while the section filter keeps dropping rows, and their size. A filter
 * GitHub expresses exactly needs one page of {@link INBOX_SECTION_LOAD_SIZE}.
 */
const CLIENT_FILTERED_SCAN_PAGE_SIZE = FULL_LIST_PAGE_SIZE;
const CLIENT_FILTERED_SCAN_MAX_PAGES = 2;

export type SectionSearchScan = {
    /** Rows that pass the section filter, in search order. */
    pullRequests: Array<PullRequestSummary>;
    /** Rows GitHub returned that the section filter dropped. */
    dropped: number;
    githubTotal: number;
    pageInfo: InboxPullRequestPageInfo;
};

/**
 * Page through a section's GitHub search until a page's worth of rows pass the section filter
 * or the results run out. The search is only a superset of filters with client-only conditions
 * (a custom section on involvement, say), so one page can be all rejects while matches sit further down.
 */
export async function scanSectionSearch(params: {
    github: GithubClient;
    token: string;
    query: string;
    repositories: ReadonlyArray<string>;
    filter: SectionFilter;
    viewerLogin: string;
    after?: string | null;
    signal?: AbortSignal;
    /** The section is collapsed: scan pages of {@link INBOX_SECTION_LOAD_SIZE} rows. */
    compact?: boolean;
}): Promise<SectionSearchScan> {
    const { github, token, query, repositories, filter, viewerLogin, signal } = params;
    const clientFiltered = sectionFilterNeedsClientFilter(filter, viewerLogin);
    // Collapsed sections show no rows: small pages are enough for their count, at a quarter of the cost.
    const pageSize = clientFiltered && !params.compact ? CLIENT_FILTERED_SCAN_PAGE_SIZE : INBOX_SECTION_LOAD_SIZE;
    const maxPages = clientFiltered ? CLIENT_FILTERED_SCAN_MAX_PAGES : 1;
    const pullRequests: Array<PullRequestSummary> = [];
    let dropped = 0;
    let githubTotal = 0;
    let pageInfo: InboxPullRequestPageInfo = { hasNextPage: false, endCursor: null };
    let after = params.after ?? null;

    for (let scanned = 0; scanned < maxPages; scanned += 1) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }

        const page = await github.fetchSectionPullRequests(token, {
            query,
            repositories: [...repositories],
            limit: pageSize,
            after,
        });
        const matching = page.pullRequests.filter((pullRequest) =>
            matchSectionFilter(pullRequest, filter, viewerLogin),
        );

        pullRequests.push(...matching);
        dropped += page.pullRequests.length - matching.length;
        githubTotal = page.totalCount;
        pageInfo = page.pageInfo;

        if (!pageInfo.hasNextPage || !pageInfo.endCursor || pullRequests.length >= INBOX_SECTION_LOAD_SIZE) {
            break;
        }
        after = pageInfo.endCursor;
    }

    return { pullRequests, dropped, githubTotal, pageInfo };
}

/**
 * Section badge count after a scan. Exact once the search is exhausted; otherwise an upper bound:
 * `upperBound` (GitHub total, or the previous estimate when loading more) minus rows just dropped.
 */
export function sectionCountAfterScan(input: {
    upperBound: number;
    dropped: number;
    matchingLoaded: number;
    hasNextPage: boolean;
}): number {
    if (!input.hasNextPage) {
        return input.matchingLoaded;
    }

    return Math.max(input.matchingLoaded, input.upperBound - input.dropped);
}
