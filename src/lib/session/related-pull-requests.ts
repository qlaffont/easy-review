import type { PullRequestState, PullRequestSummary } from "#/lib/session/types.ts";

/** Closed/merged siblings older than this are dropped. Open PRs are never age-filtered. */
export const RELATED_CLOSED_MERGED_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** GraphQL `first` for OPEN when scanning a repo for related refs. */
export const RELATED_OPEN_FETCH_CAP = 30;

/** GraphQL `first` for MERGED and CLOSED when scanning a repo for related refs. */
export const RELATED_CLOSED_OR_MERGED_FETCH_CAP = 5;

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

/** Open always; merged/closed only when updated within the retention window. */
export function isRelatedAgeEligible(
    pullRequest: Pick<PullRequestSummary, "state" | "updatedAt">,
    nowMs: number = Date.now(),
): boolean {
    if (pullRequest.state === "open") {
        return true;
    }

    const updatedAt = Date.parse(pullRequest.updatedAt);
    if (Number.isNaN(updatedAt)) {
        return false;
    }

    return nowMs - updatedAt <= RELATED_CLOSED_MERGED_MAX_AGE_MS;
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

/** Deduplicate by key, then sort open → merged → closed / updated desc. */
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
    nowMs?: number;
}): Array<PullRequestSummary> {
    const nowMs = input.nowMs ?? Date.now();
    const matched = input.pullRequests.filter(
        (pullRequest) =>
            pullRequest.repository !== input.excludeRepository &&
            matchesRelatedRefs(pullRequest, input.headRefName, input.baseRefName) &&
            isRelatedAgeEligible(pullRequest, nowMs),
    );

    return sortRelatedPullRequests(matched);
}
