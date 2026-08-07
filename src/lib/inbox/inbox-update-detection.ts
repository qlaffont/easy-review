import type { InboxQueryData } from "#/lib/query/types.ts";
import type { InboxSectionId } from "#/lib/session/inbox-sections.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

export type ExpandedSectionSnapshot = Map<string, PullRequestSummary>;

export type InboxPullRequestUpdate = {
    pullRequest: PullRequestSummary;
    summary: string;
    isNew: boolean;
};

/** PRs currently visible in expanded inbox sections — keyed by stable `key`. */
export function snapshotExpandedSections(
    data: InboxQueryData | undefined,
    expandedSectionIds: ReadonlyArray<InboxSectionId>,
): ExpandedSectionSnapshot {
    const map = new Map<string, PullRequestSummary>();
    if (!data) {
        return map;
    }

    for (const sectionId of expandedSectionIds) {
        for (const pullRequest of data.sectionPullRequests[sectionId] ?? []) {
            map.set(pullRequest.key, pullRequest);
        }
    }

    return map;
}

export function detectInboxUpdates(
    before: ExpandedSectionSnapshot,
    after: ExpandedSectionSnapshot,
): Array<InboxPullRequestUpdate> {
    const updates: Array<InboxPullRequestUpdate> = [];

    for (const pullRequest of after.values()) {
        const previous = before.get(pullRequest.key);
        if (!previous) {
            updates.push({ pullRequest, summary: "New in inbox", isNew: true });
            continue;
        }

        const summary = describePullRequestUpdate(previous, pullRequest);
        if (summary) {
            updates.push({ pullRequest, summary, isNew: false });
        }
    }

    return updates;
}

function describePullRequestUpdate(before: PullRequestSummary, after: PullRequestSummary): string | null {
    if (pullRequestFingerprint(before) === pullRequestFingerprint(after)) {
        return null;
    }

    if (before.state !== after.state) {
        if (after.state === "merged") {
            return "Merged";
        }
        if (after.state === "closed") {
            return "Closed";
        }
        return "Reopened";
    }

    if (before.reviewDecision !== after.reviewDecision) {
        switch (after.reviewDecision) {
            case "approved":
                return "Approved";
            case "changes-requested":
                return "Changes requested";
            case "review-required":
                return "Review required";
            default:
                return "Review status changed";
        }
    }

    if (before.checks !== after.checks) {
        switch (after.checks) {
            case "success":
                return "Checks passing";
            case "failure":
                return "Checks failing";
            case "pending":
                return "Checks pending";
            default:
                return "Checks updated";
        }
    }

    if (before.commentCount !== after.commentCount) {
        return after.commentCount > before.commentCount ? "New comments" : "Comments updated";
    }

    if (!sameStringArray(before.reviewRequests, after.reviewRequests)) {
        return "Review requests updated";
    }

    if (!sameReviewers(before.reviewers, after.reviewers)) {
        return "Reviews updated";
    }

    if (before.title !== after.title) {
        return "Title updated";
    }

    if (before.isDraft !== after.isDraft) {
        return after.isDraft ? "Marked draft" : "Marked ready for review";
    }

    if (before.mergeStateStatus !== after.mergeStateStatus) {
        return "Merge status updated";
    }

    return "Updated";
}

function pullRequestFingerprint(pullRequest: PullRequestSummary): string {
    return JSON.stringify({
        updatedAt: pullRequest.updatedAt,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
        reviewDecision: pullRequest.reviewDecision,
        checks: pullRequest.checks,
        commentCount: pullRequest.commentCount,
        reviewRequests: pullRequest.reviewRequests,
        reviewers: pullRequest.reviewers,
        mergeStateStatus: pullRequest.mergeStateStatus,
        title: pullRequest.title,
    });
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

function sameReviewers(left: PullRequestSummary["reviewers"], right: PullRequestSummary["reviewers"]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every(
        (reviewer, index) =>
            reviewer.login === right[index]?.login &&
            reviewer.state === right[index]?.state &&
            reviewer.reviewId === right[index]?.reviewId,
    );
}
