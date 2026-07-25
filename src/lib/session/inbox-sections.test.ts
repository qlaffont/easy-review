import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { DEFAULT_INBOX_SECTIONS, classifyPullRequest, groupIntoSections } from "#/lib/session/inbox-sections.ts";

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
        state: "open",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: null,
        headRefName: "rate-limiting",
        baseRefName: "main",
        reviewDecision: null,
        reviewRequests: [],
        reviewers: [],
        checks: "none",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commentCount: 0,
        ...overrides,
    };
}

describe("classifyPullRequest", () => {
    it("puts a review requested from you in Needs your review", () => {
        const subject = pullRequest({ reviewRequests: [VIEWER] });

        expect(classifyPullRequest(subject, VIEWER)).toBe("needs-your-review");
    });

    it("puts a re-requested review back in Needs your review even after you reviewed", () => {
        const subject = pullRequest({
            reviewRequests: [VIEWER],
            reviewers: [{ login: VIEWER, state: "approved" }],
        });

        expect(classifyPullRequest(subject, VIEWER)).toBe("needs-your-review");
    });

    it("puts a pull request you already reviewed in Waiting for author", () => {
        const subject = pullRequest({ reviewers: [{ login: VIEWER, state: "changes-requested" }] });

        expect(classifyPullRequest(subject, VIEWER)).toBe("waiting-for-author");
    });

    it("puts your own blocked pull request in Returned to you", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "changes-requested" });

        expect(classifyPullRequest(subject, VIEWER)).toBe("returned-to-you");
    });

    it("puts your own approved pull request in Approved", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "approved" });

        expect(classifyPullRequest(subject, VIEWER)).toBe("approved");
    });

    it("puts your own pending pull request in Waiting for reviewers", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "review-required" });

        expect(classifyPullRequest(subject, VIEWER)).toBe("waiting-for-reviewers");
    });

    it("puts your own draft in Drafts, whatever its review state", () => {
        const subject = pullRequest({ author: VIEWER, isDraft: true, reviewDecision: "approved" });

        expect(classifyPullRequest(subject, VIEWER)).toBe("drafts");
    });

    it("puts a merged pull request in Merging and recently merged, whoever wrote it", () => {
        const mine = pullRequest({ author: VIEWER, state: "merged", mergedAt: "2026-07-03T00:00:00.000Z" });
        const theirs = pullRequest({ state: "merged", mergedAt: "2026-07-03T00:00:00.000Z" });

        expect(classifyPullRequest(mine, VIEWER)).toBe("merging-and-recently-merged");
        expect(classifyPullRequest(theirs, VIEWER)).toBe("merging-and-recently-merged");
    });

    it("drops closed, unreviewed and other people's drafts into Other", () => {
        expect(classifyPullRequest(pullRequest({ state: "closed" }), VIEWER)).toBe("other");
        expect(classifyPullRequest(pullRequest(), VIEWER)).toBe("other");
        expect(classifyPullRequest(pullRequest({ isDraft: true }), VIEWER)).toBe("other");
    });

    it("ignores a review request that is not yours", () => {
        const subject = pullRequest({ reviewRequests: ["someone-else"] });

        expect(classifyPullRequest(subject, VIEWER)).toBe("other");
    });
});

describe("groupIntoSections", () => {
    it("keeps every section visible, including the empty ones", () => {
        const sections = groupIntoSections([pullRequest({ reviewRequests: [VIEWER] })], VIEWER);

        expect(sections).toHaveLength(DEFAULT_INBOX_SECTIONS.length);
        expect(sections.map((section) => section.pullRequests.length)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("shows the freshest pull request first inside a section", () => {
        const older = pullRequest({
            key: "acme/api#1",
            number: 1,
            reviewRequests: [VIEWER],
            updatedAt: "2026-07-01T00:00:00.000Z",
        });
        const newer = pullRequest({
            key: "acme/api#2",
            number: 2,
            reviewRequests: [VIEWER],
            updatedAt: "2026-07-09T00:00:00.000Z",
        });

        const [needsReview] = groupIntoSections([older, newer], VIEWER);

        expect(needsReview?.pullRequests.map((entry) => entry.number)).toEqual([2, 1]);
    });
});
