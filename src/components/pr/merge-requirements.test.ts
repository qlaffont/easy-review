import { describe, expect, it } from "vitest";

import type { PullRequestDetail } from "#/lib/session/types.ts";

import {
    isMergeBlockedByRequirements,
    mergeFooterHint,
    mergingBlockedDescription,
} from "#/components/pr/merge-requirements.ts";

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
    return {
        key: "acme/api#1",
        repository: "acme/api",
        number: 1,
        title: "Test",
        url: "https://github.com/acme/api/pull/1",
        author: "octocat",
        authorAvatarUrl: null,
        state: "open",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: null,
        headRefName: "feature",
        baseRefName: "dev",
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "success",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        commentCount: 0,
        mergeable: "mergeable",
        assignees: [],
        labels: [],
        body: "",
        lastEditedAt: null,
        editor: null,
        editCount: 0,
        edits: [],
        reactionGroups: [],
        headSha: "abc",
        baseSha: "def",
        checkRuns: [],
        checkCount: 1,
        requiredApprovingReviewCount: 1,
        allowedMergeMethods: ["squash"],
        defaultMergeMethod: "squash",
        commitCount: 1,
        mergeStateStatus: "blocked",
        viewerCanMergeAsAdmin: false,
        ...overrides,
    };
}

describe("merge requirements", () => {
    it("blocks merge when review is required", () => {
        expect(isMergeBlockedByRequirements(detail({ reviewDecision: "review-required" }))).toBe(true);
    });

    it("describes why merging is blocked for pending reviews", () => {
        expect(mergingBlockedDescription(detail({ reviewDecision: "review-required" }))).toContain(
            "At least 1 approving review",
        );
    });

    it("shows blocked footer when requirements fail", () => {
        expect(mergeFooterHint(detail({ reviewDecision: "review-required" }), 1, true)).toBe(
            "Merging is blocked until requirements are met.",
        );
    });
});
