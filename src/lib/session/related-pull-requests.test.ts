import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    isRelatedAgeEligible,
    isRelatedCreatedEligible,
    isRelatedMatchEligible,
    mergeRelatedPullRequests,
    selectRelatedPullRequests,
    sortRelatedPullRequests,
} from "#/lib/session/related-pull-requests.ts";

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
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
        mergedAt: null,
        headRefName: "feature/foo",
        baseRefName: "main",
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

const FOCAL_CREATED_AT = "2026-07-27T00:00:00.000Z";

describe("selectRelatedPullRequests", () => {
    it("keeps other-repo matches with the same head and base", () => {
        const items = selectRelatedPullRequests({
            pullRequests: [
                summary({ key: "acme/api#1", repository: "acme/api", number: 1 }),
                summary({ key: "acme/web#2", repository: "acme/web", number: 2 }),
                summary({
                    key: "acme/web#3",
                    repository: "acme/web",
                    number: 3,
                    headRefName: "other",
                }),
            ],
            headRefName: "feature/foo",
            baseRefName: "main",
            excludeRepository: "acme/api",
            focalCreatedAt: FOCAL_CREATED_AT,
        });

        expect(items.map((entry) => entry.key)).toEqual(["acme/web#2"]);
    });

    it("keeps open and merged within 7 days of the focal PR; drops closed and stale", () => {
        const withinWindow = "2026-07-25T00:00:00.000Z";
        const outsideWindow = "2026-07-09T00:00:00.000Z";

        const items = selectRelatedPullRequests({
            pullRequests: [
                summary({
                    key: "latomate/medical-web#196",
                    repository: "latomate/medical-web",
                    number: 196,
                    state: "merged",
                    createdAt: withinWindow,
                }),
                summary({
                    key: "latomate/medical-service#115",
                    repository: "latomate/medical-service",
                    number: 115,
                    state: "merged",
                    createdAt: outsideWindow,
                }),
                summary({
                    key: "acme/web#2",
                    repository: "acme/web",
                    number: 2,
                    state: "closed",
                    createdAt: withinWindow,
                }),
                summary({
                    key: "acme/web#3",
                    repository: "acme/web",
                    number: 3,
                    state: "open",
                    createdAt: outsideWindow,
                }),
            ],
            headRefName: "feature/foo",
            baseRefName: "main",
            excludeRepository: "acme/api",
            focalCreatedAt: FOCAL_CREATED_AT,
        });

        expect(items.map((entry) => entry.key)).toEqual(["latomate/medical-web#196"]);
    });
});

describe("sortRelatedPullRequests", () => {
    it("orders open, then merged, then closed, and updated desc within a group", () => {
        const sorted = sortRelatedPullRequests([
            summary({
                key: "acme/a#1",
                repository: "acme/a",
                number: 1,
                state: "closed",
                updatedAt: "2026-07-25T00:00:00.000Z",
            }),
            summary({
                key: "acme/b#1",
                repository: "acme/b",
                number: 1,
                state: "open",
                updatedAt: "2026-07-10T00:00:00.000Z",
            }),
            summary({
                key: "acme/c#1",
                repository: "acme/c",
                number: 1,
                state: "merged",
                updatedAt: "2026-07-20T00:00:00.000Z",
            }),
            summary({
                key: "acme/d#1",
                repository: "acme/d",
                number: 1,
                state: "open",
                updatedAt: "2026-07-22T00:00:00.000Z",
            }),
        ]);

        expect(sorted.map((entry) => entry.key)).toEqual(["acme/d#1", "acme/b#1", "acme/c#1", "acme/a#1"]);
    });
});

describe("mergeRelatedPullRequests", () => {
    it("deduplicates by key and re-sorts", () => {
        const merged = mergeRelatedPullRequests(
            [
                summary({
                    key: "acme/web#1",
                    repository: "acme/web",
                    number: 1,
                    state: "open",
                    updatedAt: "2026-07-10T00:00:00.000Z",
                }),
            ],
            [
                summary({
                    key: "acme/web#1",
                    repository: "acme/web",
                    number: 1,
                    state: "open",
                    title: "Updated title",
                    updatedAt: "2026-07-22T00:00:00.000Z",
                }),
                summary({
                    key: "acme/docs#2",
                    repository: "acme/docs",
                    number: 2,
                    state: "merged",
                    updatedAt: "2026-07-21T00:00:00.000Z",
                }),
            ],
        );

        expect(merged.map((entry) => ({ key: entry.key, title: entry.title }))).toEqual([
            { key: "acme/web#1", title: "Updated title" },
            { key: "acme/docs#2", title: "PR 2" },
        ]);
    });
});

describe("isRelatedMatchEligible", () => {
    it("keeps open and merged, drops closed", () => {
        expect(isRelatedMatchEligible({ state: "open" })).toBe(true);
        expect(isRelatedMatchEligible({ state: "merged" })).toBe(true);
        expect(isRelatedMatchEligible({ state: "closed" })).toBe(false);
    });
});

describe("isRelatedCreatedEligible", () => {
    it("accepts PRs created within 7 days of the focal PR", () => {
        expect(isRelatedCreatedEligible({ createdAt: "2026-07-25T00:00:00.000Z" }, FOCAL_CREATED_AT)).toBe(true);
        expect(isRelatedCreatedEligible({ createdAt: "2026-07-20T00:00:00.000Z" }, FOCAL_CREATED_AT)).toBe(true);
        expect(isRelatedCreatedEligible({ createdAt: "2026-07-09T00:00:00.000Z" }, FOCAL_CREATED_AT)).toBe(false);
    });

    it("combines state and created checks via isRelatedAgeEligible", () => {
        expect(
            isRelatedAgeEligible(
                { state: "merged", createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z" },
                FOCAL_CREATED_AT,
            ),
        ).toBe(true);
        expect(
            isRelatedAgeEligible(
                { state: "closed", createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z" },
                FOCAL_CREATED_AT,
            ),
        ).toBe(false);
    });
});
