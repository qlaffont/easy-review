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
