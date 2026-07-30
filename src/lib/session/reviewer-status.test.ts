import { describe, expect, it } from "vitest";

import { aggregateReviewerStatuses } from "#/lib/session/reviewer-status.ts";

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
});
