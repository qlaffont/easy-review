import { describe, expect, it } from "vitest";

import {
    aggregateReviewerStatuses,
    displayReviewDecision,
    displayReviewState,
    excludeAuthorFromReviewers,
    excludeAuthorFromReviewRequests,
} from "#/lib/session/reviewer-status.ts";

describe("aggregateReviewerStatuses", () => {
    it("shows approved when the latest review is commented but an earlier review approved", () => {
        const reviewers = aggregateReviewerStatuses([
            {
                login: "qlaffont",
                databaseId: 20,
                submittedAt: "2026-07-03T12:00:00.000Z",
                state: "COMMENTED",
            },
            {
                login: "qlaffont",
                databaseId: 10,
                submittedAt: "2026-07-03T11:00:00.000Z",
                state: "APPROVED",
            },
        ]);

        expect(reviewers).toEqual([{ login: "qlaffont", state: "approved", reviewId: 10 }]);
    });

    it("shows changes-requested when it is the newest substantive review", () => {
        const reviewers = aggregateReviewerStatuses([
            {
                login: "hubot",
                databaseId: 3,
                submittedAt: "2026-07-03T12:00:00.000Z",
                state: "CHANGES_REQUESTED",
            },
            {
                login: "hubot",
                databaseId: 2,
                submittedAt: "2026-07-03T11:00:00.000Z",
                state: "APPROVED",
            },
        ]);

        expect(reviewers).toEqual([{ login: "hubot", state: "changes-requested", reviewId: 3 }]);
    });

    it("shows commented when the reviewer never approved or requested changes", () => {
        const reviewers = aggregateReviewerStatuses([
            {
                login: "bot",
                databaseId: 5,
                submittedAt: "2026-07-03T12:00:00.000Z",
                state: "COMMENTED",
            },
        ]);

        expect(reviewers).toEqual([{ login: "bot", state: "commented", reviewId: 5 }]);
    });

    it("flags bot reviewers", () => {
        const reviewers = aggregateReviewerStatuses([
            {
                login: "coderabbitai",
                databaseId: 6,
                submittedAt: "2026-07-03T12:00:00.000Z",
                state: "COMMENTED",
                isBot: true,
            },
        ]);

        expect(reviewers).toEqual([{ login: "coderabbitai", state: "commented", reviewId: 6, isBot: true }]);
    });

    it("shows dismissed when the newest review was dismissed", () => {
        const reviewers = aggregateReviewerStatuses([
            {
                login: "mona",
                databaseId: 8,
                submittedAt: "2026-07-03T12:00:00.000Z",
                state: "DISMISSED",
            },
            {
                login: "mona",
                databaseId: 7,
                submittedAt: "2026-07-03T11:00:00.000Z",
                state: "APPROVED",
            },
        ]);

        expect(reviewers).toEqual([{ login: "mona", state: "dismissed", reviewId: 8 }]);
    });

    it("excludes the pull request author from reviewer lists", () => {
        expect(
            excludeAuthorFromReviewers("octocat", [
                { login: "octocat", state: "approved", reviewId: 1 },
                { login: "hubot", state: "commented", reviewId: 2 },
            ]),
        ).toEqual([{ login: "hubot", state: "commented", reviewId: 2 }]);
        expect(excludeAuthorFromReviewRequests("octocat", ["octocat", "hubot"])).toEqual(["hubot"]);
    });
});

describe("displayReviewState", () => {
    it("shows pending when the reviewer was re-requested", () => {
        expect(
            displayReviewState(
                "romainpm",
                [{ login: "romainpm", state: "changes-requested", reviewId: 1 }],
                ["romainpm"],
            ),
        ).toBe("pending");
    });

    it("keeps the substantive review state when no re-request is pending", () => {
        expect(
            displayReviewState("romainpm", [{ login: "romainpm", state: "changes-requested", reviewId: 1 }], []),
        ).toBe("changes-requested");
    });
});

describe("displayReviewDecision", () => {
    const base = { author: "qlaffont", reviewDecision: "approved" as const, reviewers: [], reviewRequests: [] };

    it("keeps approved when nobody is waiting on a review", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewers: [{ login: "alex", state: "approved", reviewId: 1 }],
            }),
        ).toBe("approved");
    });

    it("shows re-review requested when an approver was re-requested", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewers: [{ login: "alex", state: "approved", reviewId: 1 }],
                reviewRequests: ["alex"],
            }),
        ).toBe("re-review-requested");
    });

    it("shows review requested when approved but a new reviewer is still requested", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewers: [{ login: "alex", state: "approved", reviewId: 1 }],
                reviewRequests: ["mohamed"],
            }),
        ).toBe("review-requested");
    });

    it("ignores the author in review requests", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewers: [{ login: "alex", state: "approved", reviewId: 1 }],
                reviewRequests: ["qlaffont"],
            }),
        ).toBe("approved");
    });

    it("keeps changes requested while a changes requester was not re-requested", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewDecision: "changes-requested",
                reviewers: [
                    { login: "alex", state: "changes-requested", reviewId: 1 },
                    { login: "mohamed", state: "changes-requested", reviewId: 2 },
                ],
                reviewRequests: ["alex"],
            }),
        ).toBe("changes-requested");
    });

    it("shows re-review requested once every changes requester was re-requested", () => {
        expect(
            displayReviewDecision({
                ...base,
                reviewDecision: "changes-requested",
                reviewers: [{ login: "alex", state: "changes-requested", reviewId: 1 }],
                reviewRequests: ["alex"],
            }),
        ).toBe("re-review-requested");
    });

    it("keeps GitHub's decision when no review was submitted yet", () => {
        expect(displayReviewDecision({ ...base, reviewDecision: "review-required", reviewRequests: ["alex"] })).toBe(
            "review-required",
        );
        expect(displayReviewDecision({ ...base, reviewDecision: null })).toBeNull();
    });
});
