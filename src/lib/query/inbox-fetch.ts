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
import { sectionFilterToSearchQuery, matchSectionFilter } from "#/lib/session/section-filters.ts";

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

/** Load one inbox section from GitHub (or from the cached pool when the filter is client-only). */
export async function fetchInboxSection(params: {
    github: GithubClient;
    token: string;
    viewerLogin: string;
    selected: ReadonlyArray<string>;
    definition: InboxSectionDefinition;
    existing: InboxQueryData;
    signal?: AbortSignal;
}): Promise<SectionFetchResult> {
    const { github, token, viewerLogin, selected, definition, existing, signal } = params;

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }

    const selectedSet = new Set(selected);
    const query = sectionFilterToSearchQuery(definition.filter, viewerLogin);

    if (query) {
        const page = await github.fetchSectionPullRequests(token, {
            query,
            repositories: [...selected],
            limit: INBOX_SECTION_LOAD_SIZE,
        });
        const pullRequests = page.pullRequests.filter((pullRequest) =>
            matchSectionFilter(pullRequest, definition.filter, viewerLogin),
        );

        return {
            id: definition.id,
            pullRequests,
            totalCount: page.totalCount,
            pageInfo: page.pageInfo,
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
}): Promise<InboxFetchResult> {
    const { github, token, viewerLogin, selected, sectionLayout, existing, sectionIds, signal, onSectionLoaded } =
        params;

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
