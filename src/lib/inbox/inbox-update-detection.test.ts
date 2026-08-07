import { describe, expect, it } from "vitest";

import type { InboxQueryData } from "#/lib/query/types.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { detectInboxUpdates, snapshotExpandedSections } from "#/lib/inbox/inbox-update-detection.ts";

function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
    return {
        key: "acme/app#1",
        repository: "acme/app",
        number: 1,
        title: "Fix inbox",
        url: "https://github.com/acme/app/pull/1",
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
        ...overrides,
    };
}

const inboxData = (sectionPullRequests: InboxQueryData["sectionPullRequests"]): InboxQueryData => ({
    pullRequests: Object.values(sectionPullRequests).flat(),
    sectionPullRequests,
    sectionCounts: {},
    sectionPagination: {},
    lastLoadedAt: "2026-07-01T00:00:00.000Z",
});

describe("snapshotExpandedSections", () => {
    it("includes pull requests only from expanded sections", () => {
        const data = inboxData({
            "needs-your-review": [pullRequest({ key: "acme/app#1" })],
            drafts: [pullRequest({ key: "acme/app#2", number: 2 })],
        });

        const snapshot = snapshotExpandedSections(data, ["needs-your-review"]);
        expect([...snapshot.keys()]).toEqual(["acme/app#1"]);
    });
});

describe("detectInboxUpdates", () => {
    it("detects review and check changes", () => {
        const before = new Map([
            [
                "acme/app#1",
                pullRequest({
                    reviewDecision: "review-required",
                    checks: "pending",
                }),
            ],
        ]);
        const after = new Map([
            [
                "acme/app#1",
                pullRequest({
                    reviewDecision: "approved",
                    checks: "success",
                    updatedAt: "2026-07-02T00:00:00.000Z",
                }),
            ],
        ]);

        expect(detectInboxUpdates(before, after)).toEqual([
            {
                pullRequest: after.get("acme/app#1"),
                summary: "Approved",
                isNew: false,
            },
        ]);
    });

    it("reports new pull requests in expanded sections", () => {
        const before = new Map<string, PullRequestSummary>();
        const after = new Map([["acme/app#1", pullRequest()]]);

        expect(detectInboxUpdates(before, after)).toEqual([
            {
                pullRequest: after.get("acme/app#1"),
                summary: "New in inbox",
                isNew: true,
            },
        ]);
    });

    it("ignores unchanged pull requests", () => {
        const entry = pullRequest();
        const before = new Map([["acme/app#1", entry]]);
        const after = new Map([["acme/app#1", { ...entry }]]);

        expect(detectInboxUpdates(before, after)).toEqual([]);
    });
});
