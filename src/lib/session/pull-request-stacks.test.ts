import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    buildLinearStackChain,
    formatStackBranches,
    formatStackGhCheckoutCommands,
    formatStackUrls,
    formatTrunkLabel,
    resolvePullRequestStack,
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
        assignees: [],
        labels: [],
        ...overrides,
    };
}

describe("resolvePullRequestStack", () => {
    it("returns a two-pull-request stack bottom to top", () => {
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

        const stack = resolvePullRequestStack({
            repository: "acme/api",
            number: 148,
            pullRequests,
            defaultBranch: "dev",
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

    it("returns null for a single pull request", () => {
        const stack = resolvePullRequestStack({
            repository: "acme/api",
            number: 10,
            pullRequests: [summary({ key: "acme/api#10", repository: "acme/api", number: 10 })],
            defaultBranch: "dev",
            hideClosed: false,
        });

        expect(stack).toBeNull();
    });

    it("breaks the chain when multiple parents share the same head branch", () => {
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
                baseRefName: "dev",
            }),
            summary({
                key: "acme/api#3",
                repository: "acme/api",
                number: 3,
                headRefName: "feat-c",
                baseRefName: "feat-a",
            }),
        ];

        const stack = resolvePullRequestStack({
            repository: "acme/api",
            number: 3,
            pullRequests,
            defaultBranch: "dev",
            hideClosed: false,
        });

        expect(stack?.pullRequests.map((entry) => entry.number)).toEqual([1, 3]);
        expect(stack?.position).toBe(2);
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
            resolvePullRequestStack({
                repository: "acme/api",
                number: 195,
                pullRequests,
                defaultBranch: "dev",
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
    const stack = resolvePullRequestStack({
        repository: "acme/api",
        number: 195,
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
        defaultBranch: "dev",
        hideClosed: false,
    })!;

    it("formats urls, branches, and gh commands bottom to top", () => {
        expect(formatStackUrls(stack)).toBe(
            "https://github.com/acme/api/pull/148\nhttps://github.com/acme/api/pull/195",
        );
        expect(formatStackBranches(stack)).toBe("feat-a\nfeat-b");
        expect(formatStackGhCheckoutCommands(stack)).toBe("gh pr checkout 148 && gh pr checkout 195");
    });
});

describe("buildLinearStackChain", () => {
    it("orders three linked pull requests from trunk to top", () => {
        const pullRequests = [
            summary({
                key: "acme/api#1",
                repository: "acme/api",
                number: 1,
                headRefName: "a",
                baseRefName: "dev",
            }),
            summary({
                key: "acme/api#2",
                repository: "acme/api",
                number: 2,
                headRefName: "b",
                baseRefName: "a",
            }),
            summary({
                key: "acme/api#3",
                repository: "acme/api",
                number: 3,
                headRefName: "c",
                baseRefName: "b",
            }),
        ];

        const chain = buildLinearStackChain(pullRequests[1]!, pullRequests);
        expect(chain.map((entry) => entry.number)).toEqual([1, 2, 3]);
    });
});
