import { describe, expect, it } from "vitest";

import type { PullRequestDetail } from "#/lib/session/types.ts";

import {
    applyQueuedAutoMerge,
    describeAutoMergeBatchResult,
    isPullRequestReadyToAutoMerge,
    parseQueuedAutoMerges,
    queuedAutoMergeKey,
    queuedAutoMergeStorageKey,
    serializeQueuedAutoMerges,
    shouldUpdateBranchForAutoMerge,
    type QueuedAutoMerge,
} from "#/lib/session/queued-auto-merge.ts";
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
        requiredApprovingReviewCount: null,
        allowedMergeMethods: ["squash"],
        defaultMergeMethod: "squash",
        commitCount: 1,
        headRepositoryOwnerLogin: "acme",
        mergeCommits: [],
        mergeCommitSettings: DEFAULT_MERGE_COMMIT_SETTINGS,
        mergeStateStatus: "clean",
        viewerCanMergeAsAdmin: false,
        pullRequestNodeId: "PR_test",
        viewerCanUpdateBranch: false,
        autoMergeEnabled: false,
        autoMergeMethod: null,
        githubStackPullRequests: [],
        ...overrides,
    };
}

const queued: QueuedAutoMerge = {
    repository: "acme/api",
    number: 12,
    method: "squash",
    deleteHeadBranch: true,
};

describe("queued auto-merge", () => {
    it("keys the store per GitHub login", () => {
        expect(queuedAutoMergeStorageKey("quentin")).toBe("auto-merge:queue:quentin");
        expect(queuedAutoMergeKey("acme/api", 12)).toBe("acme/api#12");
    });

    it("round-trips a queue through JSON", () => {
        const map = new Map([[queuedAutoMergeKey(queued.repository, queued.number), queued]]);
        const parsed = parseQueuedAutoMerges(serializeQueuedAutoMerges(map));

        expect([...parsed.values()]).toEqual([queued]);
    });

    it("ignores corrupt or partial stored entries", () => {
        expect(parseQueuedAutoMerges("not-json").size).toBe(0);
        expect(parseQueuedAutoMerges(JSON.stringify([{ repository: "acme/api" }])).size).toBe(0);
        expect(parseQueuedAutoMerges(null).size).toBe(0);
    });

    it("treats GitHub auto-merge as off unless Easy Review queued it", () => {
        const fromGithub = detail({ autoMergeEnabled: true, autoMergeMethod: "merge" });

        expect(applyQueuedAutoMerge(fromGithub, undefined)).toMatchObject({
            autoMergeEnabled: false,
            autoMergeMethod: null,
        });
        expect(applyQueuedAutoMerge(fromGithub, queued)).toMatchObject({
            autoMergeEnabled: true,
            autoMergeMethod: "squash",
        });
    });

    it("is ready only when GitHub reports a mergeable open pull request", () => {
        expect(isPullRequestReadyToAutoMerge(detail())).toBe(true);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeStateStatus: "has_hooks" }))).toBe(true);
        expect(isPullRequestReadyToAutoMerge(detail({ isDraft: true, mergeStateStatus: "draft" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ state: "merged" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ reviewDecision: "review-required" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeStateStatus: "blocked" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeStateStatus: "unstable" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeStateStatus: "behind" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeStateStatus: "unknown" }))).toBe(false);
        expect(isPullRequestReadyToAutoMerge(detail({ mergeable: "conflicting", mergeStateStatus: "dirty" }))).toBe(
            false,
        );
    });

    it("updates the branch when the pull request is behind and GitHub allows it", () => {
        expect(
            shouldUpdateBranchForAutoMerge(detail({ mergeStateStatus: "behind", viewerCanUpdateBranch: true })),
        ).toBe(true);
        expect(
            shouldUpdateBranchForAutoMerge(detail({ mergeStateStatus: "behind", viewerCanUpdateBranch: false })),
        ).toBe(false);
        expect(shouldUpdateBranchForAutoMerge(detail({ mergeStateStatus: "clean", viewerCanUpdateBranch: true }))).toBe(
            false,
        );
        expect(
            shouldUpdateBranchForAutoMerge(
                detail({ mergeable: "conflicting", mergeStateStatus: "dirty", viewerCanUpdateBranch: true }),
            ),
        ).toBe(false);
        expect(
            shouldUpdateBranchForAutoMerge(
                detail({ isDraft: true, mergeStateStatus: "behind", viewerCanUpdateBranch: true }),
            ),
        ).toBe(false);
    });
});

describe("describeAutoMergeBatchResult", () => {
    it("explains merged vs still-queued pull requests", () => {
        expect(describeAutoMergeBatchResult({ queued: 3, merged: [{}] })).toBe("Merged 1 · 2 queued until ready");
        expect(describeAutoMergeBatchResult({ queued: 3, merged: [{}, {}, {}] })).toBe("Merged 3 pull requests");
        expect(describeAutoMergeBatchResult({ queued: 2, merged: [] })).toBe(
            "2 pull requests queued until they're ready",
        );
        expect(describeAutoMergeBatchResult({ queued: 1, merged: [{}] })).toBe("Merged 1 pull request");
        expect(describeAutoMergeBatchResult({ queued: 0, merged: [] })).toBe("No pull requests to auto-merge");
    });
});
