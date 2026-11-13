import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { emptyInboxQueryData, fetchInboxSections, patchInboxPullRequest } from "#/lib/query/inbox-fetch.ts";
import { EasyReviewError } from "#/lib/session/errors.ts";
import { defaultSectionLayout } from "#/lib/session/inbox-sections.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";

const TOKEN = "test_cred_valid";

function cachedSummary(title: string): PullRequestSummary {
    return {
        key: "acme/api#1",
        repository: "acme/api",
        number: 1,
        title,
        url: "https://example.com",
        author: "dev",
        authorAvatarUrl: null,
        state: "open",
        isDraft: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        mergedAt: null,
        headRefName: "feature",
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
        mergeStateStatus: "unknown",
        assignees: [],
        labels: [],
    };
}

describe("fetchInboxSections", () => {
    it("returns existing data unchanged when every section fetch fails", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        github.failAllWith(new EasyReviewError("network", "offline"));

        const existing = emptyInboxQueryData();
        existing.sectionPullRequests["needs-your-review"] = [cachedSummary("Cached PR")];
        existing.sectionCounts["needs-your-review"] = 1;
        existing.pullRequests = [...(existing.sectionPullRequests["needs-your-review"] ?? [])];

        const { data, successes } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing,
        });

        expect(successes).toBe(0);
        expect(data.sectionPullRequests["needs-your-review"]).toHaveLength(1);
        expect(data.sectionPullRequests["needs-your-review"]?.[0]?.title).toBe("Cached PR");
    });

    it("keeps untouched sections when a full refresh stops after partial success", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        github.addPullRequest(TOKEN, { repository: "acme/api", number: 1, reviewRequests: ["quentin"] });
        let call = 0;
        const original = github.fetchSectionPullRequests.bind(github);
        github.fetchSectionPullRequests = async (...args) => {
            call += 1;
            if (call >= 2) {
                throw new EasyReviewError("rate-limited", "rate limited");
            }
            return original(...args);
        };

        const sectionLayout = defaultSectionLayout();
        const existing = emptyInboxQueryData();
        existing.sectionPullRequests["approved"] = [cachedSummary("Cached approved PR")];
        existing.sectionCounts["approved"] = 1;
        existing.pullRequests = [...(existing.sectionPullRequests["approved"] ?? [])];

        const { data, successes } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout,
            existing,
        });

        expect(successes).toBeGreaterThan(0);
        expect(data.sectionPullRequests["approved"]).toHaveLength(1);
        expect(data.sectionPullRequests["approved"]?.[0]?.title).toBe("Cached approved PR");
    });

    it("counts only pull requests that remain after the section filter", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 7,
            author: "quentin",
            reviewDecision: "changes-requested",
            reviewRequests: ["romainpm"],
            reviewers: [{ login: "romainpm", state: "changes-requested", reviewId: 1 }],
        });

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]).toEqual([]);
        expect(data.sectionCounts["returned-to-you"]).toBe(0);
    });

    it("loads a PR commented by a human into Returned to you", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 9,
            author: "quentin",
            reviewDecision: "review-required",
            reviewers: [{ login: "romainpm", state: "commented", reviewId: 1 }],
        });

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]?.map((entry) => entry.number)).toEqual([9]);
        expect(data.sectionCounts["returned-to-you"]).toBe(1);
    });

    it("scans past a first page the section filter drops entirely", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        // Twelve of my PRs waiting on reviewers: GitHub returns them for Returned to you, the filter drops them.
        for (let number = 1; number <= 12; number += 1) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                author: "quentin",
                reviewDecision: "review-required",
                reviewRequests: ["romainpm"],
                updatedAt: `2026-07-${String(number + 10).padStart(2, "0")}T00:00:00.000Z`,
            });
        }

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]).toEqual([]);
        expect(data.sectionCounts["returned-to-you"]).toBe(0);
        expect(data.sectionPagination["returned-to-you"]?.hasNextPage).toBe(false);
    });

    it("finds a returned PR that sits beyond the first search page", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        for (let number = 1; number <= 12; number += 1) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                author: "quentin",
                reviewDecision: "review-required",
                reviewRequests: ["romainpm"],
                updatedAt: `2026-07-${String(number + 10).padStart(2, "0")}T00:00:00.000Z`,
            });
        }
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 42,
            author: "quentin",
            reviewDecision: "changes-requested",
            reviewers: [{ login: "romainpm", state: "changes-requested", reviewId: 1 }],
            updatedAt: "2026-07-01T00:00:00.000Z",
        });

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]?.map((entry) => entry.number)).toEqual([42]);
        expect(data.sectionCounts["returned-to-you"]).toBe(1);
    });

    it("falls back to the section's own search when I have too many open PRs to share one list", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        for (let number = 1; number <= 101; number += 1) {
            github.addPullRequest(TOKEN, {
                repository: "acme/api",
                number,
                author: "quentin",
                reviewDecision: "review-required",
                reviewRequests: ["romainpm"],
                updatedAt: new Date(Date.UTC(2026, 6, 10, 0, number)).toISOString(),
            });
        }
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 500,
            author: "quentin",
            reviewDecision: "changes-requested",
            reviewers: [{ login: "romainpm", state: "changes-requested", reviewId: 1 }],
            updatedAt: "2026-07-11T00:00:00.000Z",
        });

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]?.map((entry) => entry.number)).toEqual([500]);
        // Two pages of 50 scanned out of 102: the count stays an upper bound, and more can be loaded.
        expect(data.sectionCounts["returned-to-you"]).toBe(1 + 2);
        expect(data.sectionPagination["returned-to-you"]?.hasNextPage).toBe(true);
    });

    it("keeps the GitHub total when every fetched row still matches the section", async () => {
        const github = createFakeGithub();
        github.addAccount(TOKEN, { login: "quentin" });
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 8,
            author: "quentin",
            reviewDecision: "changes-requested",
        });

        const { data } = await fetchInboxSections({
            github,
            token: TOKEN,
            viewerLogin: "quentin",
            selected: ["acme/api"],
            sectionLayout: defaultSectionLayout(),
            existing: emptyInboxQueryData(),
        });

        expect(data.sectionPullRequests["returned-to-you"]?.map((entry) => entry.number)).toEqual([8]);
        expect(data.sectionCounts["returned-to-you"]).toBe(1);
    });
});

describe("patchInboxPullRequest", () => {
    it("moves a merged pull request out of open sections into recently merged", () => {
        const open = cachedSummary("Deploy prod");
        open.author = "quentin";
        const merged = {
            ...open,
            state: "merged" as const,
            mergedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reviewRequests: [],
        };

        const data = emptyInboxQueryData();
        data.sectionPullRequests["waiting-for-reviewers-me"] = [open];
        data.sectionPullRequests["merging-and-recently-merged"] = [];
        data.sectionCounts["waiting-for-reviewers-me"] = 1;
        data.sectionCounts["merging-and-recently-merged"] = 0;
        data.pullRequests = [open];

        const next = patchInboxPullRequest(data, merged, {
            viewerLogin: "quentin",
            sections: defaultSectionLayout(),
        });

        expect(next.sectionPullRequests["waiting-for-reviewers-me"]).toEqual([]);
        expect(next.sectionPullRequests["merging-and-recently-merged"]?.map((entry) => entry.key)).toEqual([
            "acme/api#1",
        ]);
        expect(next.sectionCounts["waiting-for-reviewers-me"]).toBe(0);
        expect(next.sectionCounts["merging-and-recently-merged"]).toBe(1);
        expect(next.pullRequests[0]?.state).toBe("merged");
    });
});
