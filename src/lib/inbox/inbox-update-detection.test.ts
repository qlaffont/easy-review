import { describe, expect, it } from "vitest";

import type { InboxQueryData } from "#/lib/query/types.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { detectNewPullRequests, snapshotSectionMembership } from "#/lib/inbox/inbox-update-detection.ts";

function pullRequest(number: number): PullRequestSummary {
    return {
        key: `acme/app#${number}`,
        repository: "acme/app",
        number,
        title: "Fix inbox",
        url: `https://github.com/acme/app/pull/${number}`,
        author: "hubot",
        authorAvatarUrl: null,
        state: "open",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        mergedAt: null,
        headRefName: "fix",
        baseRefName: "main",
        reviewDecision: "review-required",
        reviewRequests: [],
        reviewers: [],
        checks: "pending",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commentCount: 0,
        mergeable: "mergeable",
        mergeStateStatus: "clean",
        assignees: [],
        labels: [],
    };
}

function inboxData(
    sectionPullRequests: InboxQueryData["sectionPullRequests"],
    sectionCounts: InboxQueryData["sectionCounts"] = Object.fromEntries(
        Object.entries(sectionPullRequests).map(([id, rows]) => [id, rows.length]),
    ),
): InboxQueryData {
    return {
        pullRequests: Object.values(sectionPullRequests).flat(),
        sectionPullRequests,
        sectionCounts,
        sectionPagination: {},
        lastLoadedAt: "2026-07-01T00:00:00.000Z",
    };
}

function detect(before: InboxQueryData, after: InboxQueryData, sectionIds: Array<string>) {
    return detectNewPullRequests(snapshotSectionMembership(before, sectionIds), after, sectionIds).map((entry) => [
        entry.sectionId,
        entry.pullRequest.number,
    ]);
}

describe("detectNewPullRequests", () => {
    it("reports a pull request that enters a section that was empty", () => {
        const before = inboxData({ "needs-your-review": [] });
        const after = inboxData({ "needs-your-review": [pullRequest(1)] });

        expect(detect(before, after, ["needs-your-review"])).toEqual([["needs-your-review", 1]]);
    });

    it("ignores sections that are not watched", () => {
        const before = inboxData({ "needs-your-review": [], drafts: [] });
        const after = inboxData({ "needs-your-review": [], drafts: [pullRequest(1)] });

        expect(detect(before, after, ["needs-your-review"])).toEqual([]);
    });

    it("ignores pull requests already in the section, even when they changed", () => {
        const before = inboxData({ approved: [pullRequest(1)] });
        const after = inboxData({
            approved: [{ ...pullRequest(1), commentCount: 3, updatedAt: "2026-07-02T00:00:00.000Z" }],
        });

        expect(detect(before, after, ["approved"])).toEqual([]);
    });

    it("reports a pull request moving between watched sections", () => {
        const before = inboxData({ "returned-to-you": [pullRequest(1)], approved: [] });
        const after = inboxData({ "returned-to-you": [], approved: [pullRequest(1)] });

        expect(detect(before, after, ["returned-to-you", "approved"])).toEqual([["approved", 1]]);
    });

    it("reports a pull request once when it enters several watched sections", () => {
        const before = inboxData({ "needs-your-review": [], approved: [] });
        const after = inboxData({ "needs-your-review": [pullRequest(1)], approved: [pullRequest(1)] });

        expect(detect(before, after, ["needs-your-review", "approved"])).toEqual([["needs-your-review", 1]]);
    });

    it("sets a baseline instead of reporting when a section had not loaded", () => {
        const before = inboxData({});
        const after = inboxData({ approved: [pullRequest(1)] });

        expect(detect(before, after, ["approved"])).toEqual([]);
    });

    it("ignores an old pull request moving up into the loaded page of a longer section", () => {
        const before = inboxData({ approved: [pullRequest(1)] }, { approved: 2 });
        const after = inboxData({ approved: [pullRequest(2)] }, { approved: 2 });

        expect(detect(before, after, ["approved"])).toEqual([]);
    });

    it("reports new rows in a longer section up to how much its total grew", () => {
        const before = inboxData({ approved: [pullRequest(1)] }, { approved: 5 });
        const after = inboxData({ approved: [pullRequest(3), pullRequest(2)] }, { approved: 6 });

        expect(detect(before, after, ["approved"])).toEqual([["approved", 3]]);
    });
});
