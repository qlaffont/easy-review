import type { PullRequestSummary } from "#/lib/session/types.ts";

export type StackReviewerUpdate = {
    pullRequest: PullRequestSummary;
    /** Users and team names to request on this pull request. */
    missing: Array<string>;
};

export type StackReviewerPlan = {
    /** Every human reviewer across the stack (requested or already reviewed), first-seen order. */
    reviewers: Array<string>;
    /** Open pull requests that lack at least one of {@link reviewers}. */
    updates: Array<StackReviewerUpdate>;
};

function isBotLogin(login: string): boolean {
    return /\[bot\]$/i.test(login) || login === "ghost";
}

/**
 * Plan “request every reviewer on the whole stack”: union the human reviewers of all layers,
 * then list what each open layer is missing. Someone who already reviewed a layer is not
 * re-requested there, and a layer's author is never requested on their own pull request.
 */
export function planStackReviewers(pullRequests: ReadonlyArray<PullRequestSummary>): StackReviewerPlan {
    const reviewers = new Set<string>();

    for (const pullRequest of pullRequests) {
        for (const login of pullRequest.reviewRequests) {
            if (!isBotLogin(login)) {
                reviewers.add(login);
            }
        }
        for (const reviewer of pullRequest.reviewers) {
            if (!reviewer.isBot && !isBotLogin(reviewer.login)) {
                reviewers.add(reviewer.login);
            }
        }
    }

    const updates = pullRequests.flatMap((pullRequest) => {
        if (pullRequest.state !== "open") {
            return [];
        }

        const present = new Set([
            pullRequest.author,
            ...pullRequest.reviewRequests,
            ...pullRequest.reviewers.map((reviewer) => reviewer.login),
        ]);
        const missing = [...reviewers].filter((login) => !present.has(login));
        return missing.length > 0 ? [{ pullRequest, missing }] : [];
    });

    return { reviewers: [...reviewers], updates };
}
