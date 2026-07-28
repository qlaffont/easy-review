import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    RELATED_CLOSED_MERGED_MAX_AGE_MS,
    isRelatedAgeEligible,
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
        createdAt: "2026-07-01T00:00:00.000Z",
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

const NOW = Date.parse("2026-07-27T00:00:00.000Z");

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
            nowMs: NOW,
        });

        expect(items.map((entry) => entry.key)).toEqual(["acme/web#2"]);
    });

    it("drops closed and merged siblings older than 90 days", () => {
        const stale = new Date(NOW - RELATED_CLOSED_MERGED_MAX_AGE_MS - 24 * 60 * 60 * 1000).toISOString();
        const fresh = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString();

        const items = selectRelatedPullRequests({
            pullRequests: [
                summary({
                    key: "acme/web#1",
                    repository: "acme/web",
                    number: 1,
                    state: "merged",
                    updatedAt: stale,
                }),
                summary({
                    key: "acme/web#2",
                    repository: "acme/web",
                    number: 2,
                    state: "closed",
                    updatedAt: fresh,
                }),
                summary({
                    key: "acme/web#3",
                    repository: "acme/web",
                    number: 3,
                    state: "open",
                    updatedAt: stale,
                }),
            ],
            headRefName: "feature/foo",
            baseRefName: "main",
            excludeRepository: "acme/api",
            nowMs: NOW,
        });

        expect(items.map((entry) => entry.key)).toEqual(["acme/web#3", "acme/web#2"]);
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

describe("isRelatedAgeEligible", () => {
    it("always keeps open pull requests", () => {
        expect(isRelatedAgeEligible({ state: "open", updatedAt: "2010-01-01T00:00:00.000Z" }, NOW)).toBe(true);
    });
});
