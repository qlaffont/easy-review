import { describe, expect, it } from "vitest";

import type { PullRequestDetail } from "#/lib/session/types.ts";

import {
    defaultMergeCommitFields,
    isMergeBlockedByRequirements,
    mergeFooterHint,
    mergingBlockedDescription,
} from "#/components/pr/merge-requirements.ts";
import { DEFAULT_MERGE_COMMIT_SETTINGS } from "#/lib/session/types.ts";

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
        headRepositoryOwnerLogin: "acme",
        mergeCommits: [{ oid: "abc1234", messageHeadline: "Test", message: "Test\n\nBody" }],
        mergeCommitSettings: DEFAULT_MERGE_COMMIT_SETTINGS,
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

describe("defaultMergeCommitFields", () => {
    it("uses an empty extended description for squash when the repo setting is BLANK", () => {
        const result = defaultMergeCommitFields(
            detail({
                body: "PR description",
                mergeCommitSettings: {
                    ...DEFAULT_MERGE_COMMIT_SETTINGS,
                    squashMergeCommitTitle: "PR_TITLE",
                    squashMergeCommitMessage: "BLANK",
                },
            }),
            "squash",
        );

        expect(result).toEqual({ title: "Test (#1)", message: "" });
    });

    it("uses commit messages for the default squash extended description", () => {
        const result = defaultMergeCommitFields(
            detail({
                commitCount: 2,
                mergeCommits: [
                    { oid: "1111111", messageHeadline: "First change", message: "First change" },
                    { oid: "2222222", messageHeadline: "Second change", message: "Second change" },
                ],
            }),
            "squash",
        );

        expect(result.title).toBe("Test (#1)");
        expect(result.message).toBe("* First change (1111111)\n* Second change (2222222)");
    });

    it("uses the merge commit title and PR title message for merge commits", () => {
        const result = defaultMergeCommitFields(
            detail({
                title: "Add billing",
                number: 42,
                headRefName: "billing",
                headRepositoryOwnerLogin: "acme",
            }),
            "merge",
        );

        expect(result).toEqual({
            title: "Merge pull request #42 from acme/billing",
            message: "Add billing",
        });
    });
});
