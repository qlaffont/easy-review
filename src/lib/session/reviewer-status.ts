import type { PullRequestSummary, ReviewDecision, ReviewState, ReviewerStatus } from "#/lib/session/types.ts";

export type RawPullRequestReview = {
    databaseId: number;
    submittedAt: string;
    login: string;
    /** GraphQL `PullRequestReviewState` value. */
    state: string;
    isBot?: boolean;
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

function botFlag(review: RawPullRequestReview): { isBot?: true } {
    return review.isBot ? { isBot: true } : {};
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
                aggregated.push({ login, state, reviewId: review.databaseId, ...botFlag(review) });
                matched = true;
                break;
            }
        }

        if (matched) {
            continue;
        }

        const latest = sorted[0];
        if (latest && toReviewState(latest.state) === "commented") {
            aggregated.push({ login, state: "commented", reviewId: latest.databaseId, ...botFlag(latest) });
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

/**
 * GitHub shows a pending re-review when someone is in `reviewRequests`, even if their
 * latest submitted review was approve / changes-requested / commented.
 */
export function displayReviewState(
    login: string,
    reviewers: ReadonlyArray<ReviewerStatus>,
    reviewRequests: ReadonlyArray<string>,
): ReviewState {
    if (reviewRequests.includes(login)) {
        return "pending";
    }

    return reviewers.find((reviewer) => reviewer.login === login)?.state ?? "pending";
}

/** GitHub's review decision, refined by outstanding review requests. */
export type DisplayReviewDecision = ReviewDecision | "review-requested" | "re-review-requested";

/**
 * GitHub keeps `reviewDecision: APPROVED` after the author re-requests a review, so the raw
 * decision alone claims "Approved" while the author is actually waiting on reviewers. Once a
 * decision exists, an outstanding request takes over — except while a changes requester has
 * not been re-requested yet, which still hands the ball back to the author, and once an
 * approval is current (its reviewer is not awaiting a re-review), which keeps "Approved".
 */
export function displayReviewDecision(
    pullRequest: Pick<PullRequestSummary, "author" | "reviewDecision" | "reviewers" | "reviewRequests">,
): DisplayReviewDecision {
    const decision = pullRequest.reviewDecision;
    if (decision !== "approved" && decision !== "changes-requested") {
        return decision;
    }

    const reviewers = excludeAuthorFromReviewers(pullRequest.author, pullRequest.reviewers);
    const reviewRequests = excludeAuthorFromReviewRequests(pullRequest.author, pullRequest.reviewRequests);

    if (
        decision === "changes-requested" &&
        reviewers.some((reviewer) => reviewer.state === "changes-requested" && !reviewRequests.includes(reviewer.login))
    ) {
        return decision;
    }

    if (reviewRequests.length === 0) {
        return decision;
    }

    if (
        decision === "approved" &&
        reviewers.some((reviewer) => reviewer.state === "approved" && !reviewRequests.includes(reviewer.login))
    ) {
        return decision;
    }

    return reviewers.some((reviewer) => reviewRequests.includes(reviewer.login))
        ? "re-review-requested"
        : "review-requested";
}
