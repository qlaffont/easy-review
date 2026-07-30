import type { ReviewState, ReviewerStatus } from "#/lib/session/types.ts";

export type RawPullRequestReview = {
    databaseId: number;
    submittedAt: string;
    login: string;
    /** GraphQL `PullRequestReviewState` value. */
    state: string;
};

function toReviewState(state: string): ReviewState {
    switch (state) {
        case "APPROVED":
            return "approved";
        case "CHANGES_REQUESTED":
            return "changes-requested";
        case "COMMENTED":
            return "commented";
        case "DISMISSED":
            return "dismissed";
        default:
            return "pending";
    }
}

/**
 * GitHub's `latestReviews` returns the chronologically latest review per author. A later
 * COMMENTED review (e.g. inline feedback after approving) would hide an earlier APPROVED —
 * unlike github.com, which still shows the approval. Walk newest-first and skip COMMENTED
 * entries when a stronger state exists earlier in the chain.
 */
export function aggregateReviewerStatuses(reviews: ReadonlyArray<RawPullRequestReview>): Array<ReviewerStatus> {
    const byAuthor = new Map<string, Array<RawPullRequestReview>>();

    for (const review of reviews) {
        const list = byAuthor.get(review.login) ?? [];
        list.push(review);
        byAuthor.set(review.login, list);
    }

    const aggregated: Array<ReviewerStatus> = [];

    for (const [login, authorReviews] of byAuthor) {
        const sorted = [...authorReviews].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));

        let matched = false;
        for (const review of sorted) {
            const state = toReviewState(review.state);
            if (state === "dismissed" || state === "changes-requested" || state === "approved") {
                aggregated.push({ login, state, reviewId: review.databaseId });
                matched = true;
                break;
            }
        }

        if (matched) {
            continue;
        }

        const latest = sorted[0];
        if (latest && toReviewState(latest.state) === "commented") {
            aggregated.push({ login, state: "commented", reviewId: latest.databaseId });
        }
    }

    return aggregated;
}

/** PR authors are not meaningful reviewers — match github.com sidebar behavior. */
export function excludeAuthorFromReviewers<T extends { login: string }>(
    author: string,
    reviewers: ReadonlyArray<T>,
): Array<T> {
    return reviewers.filter((reviewer) => reviewer.login !== author);
}

export function excludeAuthorFromReviewRequests(author: string, reviewRequests: ReadonlyArray<string>): Array<string> {
    return reviewRequests.filter((login) => login !== author);
}
