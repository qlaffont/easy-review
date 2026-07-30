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

type SectionFetchResult = {
    id: InboxSectionId;
    pullRequests: Array<PullRequestSummary>;
    totalCount: number;
    pageInfo: InboxPullRequestPageInfo;
};

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
}): Promise<InboxFetchResult> {
    const { github, token, viewerLogin, selected, sectionLayout, existing, sectionIds, signal } = params;

    if (selected.length === 0) {
        return { data: emptyInboxQueryData(), successes: 0, failure: null };
    }

    const selectedSet = new Set(selected);
    const definitions: ReadonlyArray<InboxSectionDefinition> = sectionIds
        ? allSectionDefinitions(sectionLayout).filter((definition) => sectionIds.includes(definition.id))
        : visibleSectionDefinitions(sectionLayout);

    let failure: ReturnType<typeof toSessionError> | null = null;
    let successes = 0;
    let stopFetching = false;
    const results: Array<SectionFetchResult | null> = [];

    for (const definition of definitions) {
        if (stopFetching || signal?.aborted) {
            break;
        }

        const query = sectionFilterToSearchQuery(definition.filter, viewerLogin);

        try {
            if (query) {
                const page = await github.fetchSectionPullRequests(token, {
                    query,
                    repositories: [...selected],
                    limit: INBOX_SECTION_LOAD_SIZE,
                });
                successes += 1;
                results.push({ id: definition.id, ...page });
                continue;
            }

            const matched = existing.pullRequests
                .filter(
                    (pullRequest) =>
                        selectedSet.has(pullRequest.repository) &&
                        matchSectionFilter(pullRequest, definition.filter, viewerLogin),
                )
                .sort(comparePullRequestsByUpdatedAtDesc);
            const pullRequests = matched.slice(0, INBOX_SECTION_LOAD_SIZE);
            successes += 1;
            results.push({
                id: definition.id,
                pullRequests,
                totalCount: matched.length,
                pageInfo: {
                    hasNextPage: matched.length > pullRequests.length,
                    endCursor: matched.length > pullRequests.length ? String(pullRequests.length) : null,
                },
            });
        } catch (error) {
            failure ??= toSessionError(error);
            results.push(null);
            if (isRateLimitedError(error)) {
                stopFetching = true;
            }
        }
    }

    if (successes === 0) {
        return { data: existing, successes, failure };
    }

    // Always merge with existing — never start from empty on full refresh.
    const sectionPullRequests = { ...existing.sectionPullRequests };
    const sectionCounts = { ...existing.sectionCounts };
    const sectionPagination = { ...existing.sectionPagination };
    let mergedPool = [...existing.pullRequests];

    for (const result of results) {
        if (!result) {
            continue;
        }

        sectionPullRequests[result.id] = result.pullRequests;
        sectionCounts[result.id] = result.totalCount;
        sectionPagination[result.id] = result.pageInfo;
        mergedPool = mergePullRequestSummaries(mergedPool, result.pullRequests);
    }

    return {
        data: {
            pullRequests: mergedPool,
            sectionPullRequests,
            sectionCounts,
            sectionPagination,
            lastLoadedAt: new Date().toISOString(),
        },
        successes,
        failure,
    };
}

export function patchInboxPullRequest(data: InboxQueryData, summary: PullRequestSummary): InboxQueryData {
    const pullRequests = data.pullRequests.some((pullRequest) => pullRequest.key === summary.key)
        ? data.pullRequests.map((pullRequest) => (pullRequest.key === summary.key ? summary : pullRequest))
        : data.pullRequests;

    const sectionPullRequests = Object.fromEntries(
        Object.entries(data.sectionPullRequests).map(([sectionId, rows]) => [
            sectionId,
            rows.map((pullRequest) => (pullRequest.key === summary.key ? summary : pullRequest)),
        ]),
    );

    return { ...data, pullRequests, sectionPullRequests };
}
