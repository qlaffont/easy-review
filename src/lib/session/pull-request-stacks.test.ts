import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    formatStackBranches,
    formatStackGhCheckoutCommands,
    formatStackUrls,
    formatTrunkLabel,
    nextStackPullRequestAfterReview,
    resolveGithubPullRequestStack,
} from "#/lib/session/pull-request-stacks.ts";

function summary(
    overrides: Partial<PullRequestSummary> & Pick<PullRequestSummary, "key" | "repository" | "number">,
): PullRequestSummary {
    return {
        title: overrides.title ?? `PR ${overrides.number}`,
        url: `https://github.com/${overrides.repository}/pull/${overrides.number}`,
        author: "octocat",
        authorAvatarUrl: null,
        state: "open",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
        mergedAt: null,
        headRefName: "feature/foo",
        baseRefName: "dev",
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "none",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commentCount: 0,
        mergeable: "unknown",
        mergeStateStatus: "unknown",
        assignees: [],
        labels: [],
        ...overrides,
    };
}

describe("resolveGithubPullRequestStack", () => {
    it("returns GitHub stack layers bottom to top", () => {
        const pullRequests = [
            summary({
                key: "acme/api#148",
                repository: "acme/api",
                number: 148,
                headRefName: "feat-a",
                baseRefName: "dev",
                state: "merged",
            }),
            summary({
                key: "acme/api#195",
                repository: "acme/api",
                number: 195,
                headRefName: "feat-b",
                baseRefName: "feat-a",
            }),
        ];

        const stack = resolveGithubPullRequestStack({
            repository: "acme/api",
            number: 148,
            githubStack: { number: 1, size: 2, position: 1, baseRefName: "dev" },
            pullRequests,
            hideClosed: false,
        });

        expect(stack).toMatchObject({
            repository: "acme/api",
            position: 1,
            total: 2,
            trunkRefName: "dev",
            trunkLabel: "dev (trunk)",
        });
        expect(stack?.pullRequests.map((entry) => entry.number)).toEqual([148, 195]);
    });

    it("returns null when GitHub reports no stack", () => {
        const stack = resolveGithubPullRequestStack({
            repository: "acme/api",
            number: 10,
            githubStack: null,
            pullRequests: [summary({ key: "acme/api#10", repository: "acme/api", number: 10 })],
            hideClosed: false,
        });

        expect(stack).toBeNull();
    });

    it("does not infer a stack from branch names alone", () => {
        const pullRequests = [
            summary({
                key: "acme/api#1",
                repository: "acme/api",
                number: 1,
                headRefName: "feat-a",
                baseRefName: "dev",
            }),
            summary({
                key: "acme/api#2",
                repository: "acme/api",
                number: 2,
                headRefName: "feat-b",
                baseRefName: "feat-a",
            }),
        ];

        expect(
            resolveGithubPullRequestStack({
                repository: "acme/api",
                number: 2,
                githubStack: null,
                pullRequests,
                hideClosed: false,
            }),
        ).toBeNull();
    });

    it("hides closed pull requests when requested", () => {
        const pullRequests = [
            summary({
                key: "acme/api#148",
                repository: "acme/api",
                number: 148,
                headRefName: "feat-a",
                baseRefName: "dev",
                state: "closed",
            }),
            summary({
                key: "acme/api#195",
                repository: "acme/api",
                number: 195,
                headRefName: "feat-b",
                baseRefName: "feat-a",
            }),
        ];

        expect(
            resolveGithubPullRequestStack({
                repository: "acme/api",
                number: 195,
                githubStack: { number: 1, size: 2, position: 2, baseRefName: "dev" },
                pullRequests,
                hideClosed: true,
            }),
        ).toBeNull();
    });
});

describe("formatTrunkLabel", () => {
    it("labels the default branch as trunk", () => {
        expect(formatTrunkLabel("dev", "dev")).toBe("dev (trunk)");
        expect(formatTrunkLabel("feat-a", "dev")).toBe("feat-a");
    });
});

describe("stack copy helpers", () => {
    const stack = resolveGithubPullRequestStack({
        repository: "acme/api",
        number: 195,
        githubStack: { number: 1, size: 2, position: 2, baseRefName: "dev" },
        pullRequests: [
            summary({
                key: "acme/api#148",
                repository: "acme/api",
                number: 148,
                headRefName: "feat-a",
                baseRefName: "dev",
            }),
            summary({
                key: "acme/api#195",
                repository: "acme/api",
                number: 195,
                headRefName: "feat-b",
                baseRefName: "feat-a",
            }),
        ],
        hideClosed: false,
    })!;

    it("formats urls, branches, and gh commands bottom to top", () => {
        expect(formatStackUrls(stack)).toBe(
            "https://github.com/acme/api/pull/148\nhttps://github.com/acme/api/pull/195",
        );
        expect(formatStackBranches(stack)).toBe("feat-a\nfeat-b");
        expect(formatStackGhCheckoutCommands(stack)).toBe("gh pr checkout 148\ngh pr checkout 195");
    });
});

describe("nextStackPullRequestAfterReview", () => {
    const layers = [
        summary({ key: "acme/api#374", repository: "acme/api", number: 374 }),
        summary({ key: "acme/api#546", repository: "acme/api", number: 546 }),
        summary({ key: "acme/api#547", repository: "acme/api", number: 547, state: "merged" }),
        summary({ key: "acme/api#548", repository: "acme/api", number: 548, state: "closed" }),
        summary({ key: "acme/api#549", repository: "acme/api", number: 549 }),
    ];
    const enabled = { enabled: true, hideClosed: false, openNextInStackAfterReview: true };

    function detailAt(number: number) {
        return {
            repository: "acme/api",
            number,
            githubStack: { number: 1, size: layers.length, position: 1, baseRefName: "dev" },
            githubStackPullRequests: layers,
        };
    }

    it("skips merged and closed layers to the next open one above", () => {
        expect(nextStackPullRequestAfterReview(detailAt(546), enabled)?.number).toBe(549);
        expect(nextStackPullRequestAfterReview(detailAt(374), enabled)?.number).toBe(546);
    });

    it("returns null at the top of the stack", () => {
        expect(nextStackPullRequestAfterReview(detailAt(549), enabled)).toBeNull();
    });

    it("returns null when the option or stacks are off", () => {
        expect(
            nextStackPullRequestAfterReview(detailAt(546), { ...enabled, openNextInStackAfterReview: false }),
        ).toBeNull();
        expect(nextStackPullRequestAfterReview(detailAt(546), { ...enabled, enabled: false })).toBeNull();
    });

    it("returns null outside a stack", () => {
        expect(nextStackPullRequestAfterReview({ ...detailAt(546), githubStack: null }, enabled)).toBeNull();
    });
});
