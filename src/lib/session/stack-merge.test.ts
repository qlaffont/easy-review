import { describe, expect, it } from "vitest";

import type { ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { evaluateStackMerge, stackMergeStatusLabel } from "#/lib/session/stack-merge.ts";

function summary(
    overrides: Partial<PullRequestSummary> & Pick<PullRequestSummary, "number" | "headRefName" | "baseRefName">,
): PullRequestSummary {
    return {
        key: `acme/api#${overrides.number}`,
        repository: "acme/api",
        number: overrides.number,
        title: overrides.title ?? `PR ${overrides.number}`,
        url: `https://github.com/acme/api/pull/${overrides.number}`,
        author: "dev",
        authorAvatarUrl: null,
        state: overrides.state ?? "open",
        isDraft: overrides.isDraft ?? false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: overrides.mergedAt ?? null,
        reviewDecision: overrides.reviewDecision ?? null,
        reviewRequests: [],
        reviewers: [],
        checks: overrides.checks ?? "success",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commentCount: 0,
        mergeable: overrides.mergeable ?? "mergeable",
        mergeStateStatus: overrides.mergeStateStatus ?? "clean",
        assignees: [],
        labels: [],
        headRefName: overrides.headRefName,
        baseRefName: overrides.baseRefName,
    };
}

function stack(pullRequests: Array<PullRequestSummary>): ResolvedPullRequestStack {
    return {
        repository: "acme/api",
        pullRequests,
        trunkRefName: pullRequests[0]!.baseRefName,
        trunkLabel: pullRequests[0]!.baseRefName,
        position: 2,
        total: pullRequests.length,
    };
}

describe("evaluateStackMerge", () => {
    it("allows merge when every open pull request is ready", () => {
        const evaluation = evaluateStackMerge(
            stack([
                summary({ number: 289, headRefName: "feat-a", baseRefName: "dev", reviewDecision: "approved" }),
                summary({ number: 332, headRefName: "feat-b", baseRefName: "feat-a", reviewDecision: "approved" }),
            ]),
        );

        expect(evaluation.canMerge).toBe(true);
        expect(evaluation.mergeOrder.map((pullRequest) => pullRequest.number)).toEqual([289, 332]);
    });

    it("blocks the stack when the bottom pull request has conflicts", () => {
        const evaluation = evaluateStackMerge(
            stack([
                summary({
                    number: 289,
                    headRefName: "feat-a",
                    baseRefName: "dev",
                    reviewDecision: "approved",
                    mergeable: "conflicting",
                    mergeStateStatus: "dirty",
                }),
                summary({ number: 332, headRefName: "feat-b", baseRefName: "feat-a", reviewDecision: "approved" }),
            ]),
        );

        expect(evaluation.canMerge).toBe(false);
        expect(stackMergeStatusLabel(evaluation.rows[0]!.status)).toBe("Conflicts");
        expect(stackMergeStatusLabel(evaluation.rows[1]!.status)).toBe("Blocked downstack");
        expect(evaluation.blockMessage).toContain("#289");
    });

    it("allows merging the remaining open layer after downstack pull requests land", () => {
        const evaluation = evaluateStackMerge(
            stack([
                summary({ number: 289, headRefName: "feat-a", baseRefName: "dev", state: "merged", mergedAt: "x" }),
                summary({ number: 332, headRefName: "feat-b", baseRefName: "feat-a", reviewDecision: "approved" }),
            ]),
            { upToNumber: 332 },
        );

        expect(evaluation.canMerge).toBe(true);
        expect(evaluation.mergeOrder.map((pullRequest) => pullRequest.number)).toEqual([332]);
    });
});
