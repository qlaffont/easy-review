import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { parseGraphiteStackComment, resolveStackFromGraphiteComment } from "#/lib/session/graphite-stack-comments.ts";

const GRAPHITE_COMMENT = `* **#329** <a href="https://app.graphite.com/github/pr/latomate/medical-web/329">Graphite</a> 👈 (View in Graphite)
* **#327** <a href="https://app.graphite.com/github/pr/latomate/medical-web/327">Graphite</a>
* **#310** <a href="https://app.graphite.com/github/pr/latomate/medical-web/310">Graphite</a>
* \`dev\`

This stack of pull requests is managed by <a href="https://graphite.dev">Graphite</a>. Learn more about <a href="https://stacking.dev">stacking</a>.`;

function summary(
    overrides: Partial<PullRequestSummary> & Pick<PullRequestSummary, "key" | "repository" | "number">,
): PullRequestSummary {
    return {
        title: overrides.title ?? `PR ${overrides.number}`,
        url: `https://github.com/${overrides.repository}/pull/${overrides.number}`,
        author: "octocat",
        authorAvatarUrl: null,
        state: "merged",
        isDraft: false,
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        mergedAt: "2026-07-29T00:00:00.000Z",
        headRefName: `branch-${overrides.number}`,
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

describe("parseGraphiteStackComment", () => {
    it("parses PR order, focal marker, and trunk branch", () => {
        expect(parseGraphiteStackComment(GRAPHITE_COMMENT)).toEqual({
            numbersTopToBottom: [329, 327, 310],
            focalNumber: 329,
            trunkRefName: "dev",
        });
    });

    it("ignores unrelated comments", () => {
        expect(parseGraphiteStackComment("Looks good to me")).toBeNull();
    });
});

describe("resolveStackFromGraphiteComment", () => {
    it("builds a stack for the focal pull request", () => {
        const comment = parseGraphiteStackComment(GRAPHITE_COMMENT)!;
        const stack = resolveStackFromGraphiteComment({
            repository: "latomate/medical-web",
            number: 329,
            comment,
            pullRequests: [310, 327, 329].map((number) =>
                summary({ key: `latomate/medical-web#${number}`, repository: "latomate/medical-web", number }),
            ),
            defaultBranch: "dev",
            hideClosed: false,
        });

        expect(stack).toMatchObject({
            position: 3,
            total: 3,
            trunkRefName: "dev",
        });
        expect(stack?.pullRequests.map((entry) => entry.number)).toEqual([310, 327, 329]);
    });
});
