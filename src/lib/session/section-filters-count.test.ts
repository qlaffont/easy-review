import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    defaultFilterForPreset,
    matchesSectionSearchCountQuery,
    sectionFilterToSearchQuery,
    RECENTLY_MERGED_WITHIN_DAYS,
} from "#/lib/session/section-filters.ts";

const VIEWER = "quentin";

function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
    return {
        key: "acme/api#1",
        repository: "acme/api",
        number: 1,
        title: "Add rate limiting",
        url: "https://github.com/acme/api/pull/1",
        author: "octocat",
        authorAvatarUrl: null,
        state: "merged",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: "2026-07-02T00:00:00.000Z",
        headRefName: "feature",
        baseRefName: "main",
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "none",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        commentCount: 0,
        mergeable: "unknown",
        assignees: [],
        labels: [],
        ...overrides,
    };
}

describe("sectionFilterToSearchQuery", () => {
    it("builds a merged-within-days query for the preset section", () => {
        const query = sectionFilterToSearchQuery(defaultFilterForPreset("merging-and-recently-merged"), VIEWER);

        expect(query).toMatch(/^is:pr is:merged merged:>\d{4}-\d{2}-\d{2}$/);
    });

    it("returns null for filters GitHub search cannot express", () => {
        expect(
            sectionFilterToSearchQuery(
                {
                    cases: [
                        {
                            id: "case",
                            name: "Checks",
                            conditions: [{ id: "c", field: "checks", op: "is", value: "success" }],
                        },
                    ],
                },
                VIEWER,
            ),
        ).toBeNull();
    });

    it("matches merged pull requests against the generated query", () => {
        const query = sectionFilterToSearchQuery(defaultFilterForPreset("merging-and-recently-merged"), VIEWER)!;
        const recent = pullRequest({ mergedAt: new Date().toISOString() });
        const stale = pullRequest({
            key: "acme/api#2",
            number: 2,
            mergedAt: new Date(Date.now() - (RECENTLY_MERGED_WITHIN_DAYS + 5) * 86_400_000).toISOString(),
        });

        expect(matchesSectionSearchCountQuery(recent, query, VIEWER)).toBe(true);
        expect(matchesSectionSearchCountQuery(stale, query, VIEWER)).toBe(false);
    });
});
