import type { PullRequestState, PullRequestSummary } from "#/lib/session/types.ts";

/** Related PRs must be created within this many days of the focal PR's creation. */
export const RELATED_CREATED_WINDOW_DAYS = 7;

/** @deprecated Related matches no longer age-filter merged PRs. Kept for older imports. */
export const RELATED_CLOSED_MERGED_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** @deprecated Related discovery uses search; open-window caps are unused. */
export const RELATED_OPEN_FETCH_CAP = 30;

/** @deprecated Related discovery uses search; merged-window caps are unused. */
export const RELATED_MERGED_FETCH_CAP = 5;

/** @deprecated Use {@link RELATED_MERGED_FETCH_CAP}. */
export const RELATED_CLOSED_OR_MERGED_FETCH_CAP = RELATED_MERGED_FETCH_CAP;

/** How many related rows the sidebar shows before “Show N more”. */
export const RELATED_SIDEBAR_VISIBLE_CAP = 5;

const STATE_ORDER: Record<PullRequestState, number> = {
    open: 0,
    merged: 1,
    closed: 2,
};

export function matchesRelatedRefs(
    pullRequest: Pick<PullRequestSummary, "headRefName" | "baseRefName">,
    headRefName: string,
    baseRefName: string,
): boolean {
    return pullRequest.headRefName === headRefName && pullRequest.baseRefName === baseRefName;
}

/** Related matches are open (incl. draft) or merged — never closed. */
export function isRelatedMatchEligible(pullRequest: Pick<PullRequestSummary, "state">): boolean {
    return pullRequest.state !== "closed";
}

export function isRelatedCreatedEligible(
    pullRequest: Pick<PullRequestSummary, "createdAt">,
    focalCreatedAt: string,
): boolean {
    const focalMs = Date.parse(focalCreatedAt);
    const createdMs = Date.parse(pullRequest.createdAt);
    if (Number.isNaN(focalMs) || Number.isNaN(createdMs)) {
        return true;
    }

    const windowMs = RELATED_CREATED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return Math.abs(createdMs - focalMs) <= windowMs;
}

/** @deprecated Use {@link isRelatedCreatedEligible}. */
export function isRelatedAgeEligible(
    pullRequest: Pick<PullRequestSummary, "state" | "createdAt" | "updatedAt">,
    focalCreatedAt: string,
): boolean {
    return isRelatedMatchEligible(pullRequest) && isRelatedCreatedEligible(pullRequest, focalCreatedAt);
}

export function sortRelatedPullRequests(pullRequests: ReadonlyArray<PullRequestSummary>): Array<PullRequestSummary> {
    return [...pullRequests].sort((left, right) => {
        const byState = STATE_ORDER[left.state] - STATE_ORDER[right.state];
        if (byState !== 0) {
            return byState;
        }

        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

/** Deduplicate by key, then sort open → merged / updated desc. */
export function mergeRelatedPullRequests(
    existing: ReadonlyArray<PullRequestSummary>,
    incoming: ReadonlyArray<PullRequestSummary>,
): Array<PullRequestSummary> {
    const byKey = new Map<string, PullRequestSummary>();
    for (const pullRequest of existing) {
        byKey.set(pullRequest.key, pullRequest);
    }
    for (const pullRequest of incoming) {
        byKey.set(pullRequest.key, pullRequest);
    }

    return sortRelatedPullRequests([...byKey.values()]);
}

export function selectRelatedPullRequests(input: {
    pullRequests: ReadonlyArray<PullRequestSummary>;
    headRefName: string;
    baseRefName: string;
    excludeRepository: string;
    focalCreatedAt: string;
}): Array<PullRequestSummary> {
    const matched = input.pullRequests.filter(
        (pullRequest) =>
            isRelatedMatchEligible(pullRequest) &&
            isRelatedCreatedEligible(pullRequest, input.focalCreatedAt) &&
            pullRequest.repository !== input.excludeRepository &&
            matchesRelatedRefs(pullRequest, input.headRefName, input.baseRefName),
    );

    return sortRelatedPullRequests(matched);
}
