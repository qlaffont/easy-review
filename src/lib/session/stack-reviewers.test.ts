import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { planStackReviewers } from "#/lib/session/stack-reviewers.ts";

function summary(overrides: Partial<PullRequestSummary> & Pick<PullRequestSummary, "number">): PullRequestSummary {
    return {
        key: `acme/api#${overrides.number}`,
        repository: "acme/api",
        title: `PR ${overrides.number}`,
        url: `https://github.com/acme/api/pull/${overrides.number}`,
        author: "dev",
        authorAvatarUrl: null,
        state: "open",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: null,
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "success",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commentCount: 0,
        mergeable: "mergeable",
        mergeStateStatus: "clean",
        assignees: [],
        labels: [],
        headRefName: `feat-${overrides.number}`,
        baseRefName: "dev",
        ...overrides,
    };
}

describe("planStackReviewers", () => {
    it("requests every human reviewer of the stack on the layers that lack them", () => {
        const plan = planStackReviewers([
            summary({
                number: 1,
                reviewRequests: ["alex"],
                reviewers: [
                    { login: "coderabbitai", state: "commented", reviewId: 1, isBot: true },
                    { login: "mohamed", state: "approved", reviewId: 2 },
                ],
            }),
            summary({ number: 2, reviewRequests: ["mohamed"] }),
            summary({ number: 3 }),
        ]);

        expect(plan.reviewers).toEqual(["alex", "mohamed"]);
        expect(plan.updates.map(({ pullRequest, missing }) => [pullRequest.number, missing])).toEqual([
            [2, ["alex"]],
            [3, ["alex", "mohamed"]],
        ]);
    });

    it("skips bots, each layer's author, existing reviewers, and closed or merged layers", () => {
        const plan = planStackReviewers([
            summary({ number: 1, state: "merged", reviewRequests: ["alex", "renovate[bot]"] }),
            summary({ number: 2, author: "alex", reviewers: [{ login: "dev", state: "approved", reviewId: 3 }] }),
            summary({ number: 3, state: "closed" }),
        ]);

        expect(plan.reviewers).toEqual(["alex", "dev"]);
        expect(plan.updates).toEqual([]);
    });

    it("keeps team review requests by name", () => {
        const plan = planStackReviewers([summary({ number: 1, reviewRequests: ["Platform"] }), summary({ number: 2 })]);

        expect(plan.updates).toEqual([{ pullRequest: expect.objectContaining({ number: 2 }), missing: ["Platform"] }]);
    });
});
