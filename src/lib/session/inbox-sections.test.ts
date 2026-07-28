import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    DEFAULT_INBOX_SECTIONS,
    defaultSectionLayout,
    groupIntoSections,
    normalizeSectionLayout,
    parseInboxSettings,
    visibleSectionDefinitions,
} from "#/lib/session/inbox-sections.ts";
import { defaultFilterForPreset, matchSectionFilter } from "#/lib/session/section-filters.ts";

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
        mergeable: "mergeable",
        assignees: [],
        labels: [],
        ...overrides,
    };
}

describe("default section filters", () => {
    it("puts a review requested from you in Needs your review", () => {
        const subject = pullRequest({ reviewRequests: [VIEWER] });
        expect(matchSectionFilter(subject, defaultFilterForPreset("needs-your-review"), VIEWER)).toBe(true);
    });

    it("puts a re-requested review back in Needs your review even after you reviewed", () => {
        const subject = pullRequest({
            reviewRequests: [VIEWER],
            reviewers: [{ login: VIEWER, state: "approved", reviewId: 1 }],
        });
        expect(matchSectionFilter(subject, defaultFilterForPreset("needs-your-review"), VIEWER)).toBe(true);
    });

    it("puts a pull request you already reviewed in Waiting for author", () => {
        const subject = pullRequest({
            reviewers: [{ login: VIEWER, state: "changes-requested", reviewId: 2 }],
        });
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-author"), VIEWER)).toBe(true);
        expect(matchSectionFilter(subject, defaultFilterForPreset("needs-your-review"), VIEWER)).toBe(false);
    });

    it("puts your own blocked pull request in Returned to you", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "changes-requested" });
        expect(matchSectionFilter(subject, defaultFilterForPreset("returned-to-you"), VIEWER)).toBe(true);
    });

    it("puts your own approved pull request in Approved", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "approved" });
        expect(matchSectionFilter(subject, defaultFilterForPreset("approved"), VIEWER)).toBe(true);
    });

    it("puts your own pending pull request in Waiting for reviewers (me)", () => {
        const subject = pullRequest({ author: VIEWER, reviewDecision: "review-required" });
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-reviewers-me"), VIEWER)).toBe(true);
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-reviewers"), VIEWER)).toBe(false);
    });

    it("puts someone else's pending pull request in Waiting for reviewers", () => {
        const subject = pullRequest({ author: "octocat", reviewDecision: "review-required" });
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-reviewers"), VIEWER)).toBe(true);
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-reviewers-me"), VIEWER)).toBe(false);
    });

    it("keeps PRs requested of you out of Waiting for reviewers", () => {
        const subject = pullRequest({
            author: "octocat",
            reviewDecision: "review-required",
            reviewRequests: [VIEWER],
        });
        expect(matchSectionFilter(subject, defaultFilterForPreset("waiting-for-reviewers"), VIEWER)).toBe(false);
        expect(matchSectionFilter(subject, defaultFilterForPreset("needs-your-review"), VIEWER)).toBe(true);
    });

    it("puts your own draft in Drafts, whatever its review state", () => {
        const subject = pullRequest({ author: VIEWER, isDraft: true, reviewDecision: "approved" });
        expect(matchSectionFilter(subject, defaultFilterForPreset("drafts"), VIEWER)).toBe(true);
        expect(matchSectionFilter(subject, defaultFilterForPreset("approved"), VIEWER)).toBe(false);
    });

    it("puts a merged pull request in Merging and recently merged", () => {
        const mine = pullRequest({ author: VIEWER, state: "merged", mergedAt: "2026-07-03T00:00:00.000Z" });
        expect(matchSectionFilter(mine, defaultFilterForPreset("merging-and-recently-merged"), VIEWER)).toBe(true);
    });

    it("does not put unmatched PRs into any default section", () => {
        const closed = pullRequest({ state: "closed" });
        const strangerApproved = pullRequest({ reviewDecision: "approved" });
        const otherDraft = pullRequest({ isDraft: true });

        for (const id of DEFAULT_INBOX_SECTIONS.map((section) => section.id)) {
            expect(matchSectionFilter(closed, defaultFilterForPreset(id), VIEWER)).toBe(false);
            expect(matchSectionFilter(strangerApproved, defaultFilterForPreset(id), VIEWER)).toBe(false);
            expect(matchSectionFilter(otherDraft, defaultFilterForPreset(id), VIEWER)).toBe(false);
        }
    });

    it("upgrades a legacy Waiting for reviewers default to exclude requested-of-you", () => {
        const layout = normalizeSectionLayout([
            {
                id: "waiting-for-reviewers",
                filter: {
                    cases: [
                        {
                            id: "case_old",
                            name: "My open PR waiting on review",
                            conditions: [
                                { id: "c1", field: "author", op: "is_not", value: "@me" },
                                { id: "c2", field: "state", op: "is", value: "open" },
                                { id: "c3", field: "isDraft", op: "is", value: false },
                                { id: "c4", field: "reviewDecision", op: "is_not", value: "changes-requested" },
                                { id: "c5", field: "reviewDecision", op: "is_not", value: "approved" },
                            ],
                        },
                    ],
                },
            },
        ]);
        const waiting = layout.find((entry) => entry.id === "waiting-for-reviewers");
        expect(
            waiting?.filter.cases[0]?.conditions.some(
                (condition) =>
                    condition.field === "reviewRequests" &&
                    condition.op === "does_not_include" &&
                    condition.value === "@me",
            ),
        ).toBe(true);
    });
});

describe("section layout", () => {
    it("appends missing defaults, keeps customs, and drops unknown ids", () => {
        const layout = normalizeSectionLayout([
            { id: "other", label: "Misc", hidden: false },
            { id: "needs-your-review", label: "  ", hidden: true },
            { id: "needs-your-review", label: "dup", hidden: false },
            { id: "custom_abc", label: "Mine", hidden: false, filter: { cases: [] } },
        ]);

        expect(layout[0]).toMatchObject({ id: "other", label: "Misc", kind: "custom" });
        expect(layout.find((entry) => entry.id === "needs-your-review")).toMatchObject({
            label: "  ",
            hidden: true,
            color: "amber",
            icon: "eye",
            kind: "preset",
        });
        expect(layout.find((entry) => entry.id === "custom_abc")).toMatchObject({
            label: "Mine",
            kind: "custom",
        });
        expect(layout).toHaveLength(DEFAULT_INBOX_SECTIONS.length + 2);
    });

    it("keeps custom color and icon, and falls back when invalid", () => {
        const layout = normalizeSectionLayout([
            { id: "approved", label: "Ship it", hidden: false, color: "violet", icon: "star", customColor: "#0f0" },
            {
                id: "drafts",
                label: "Drafts",
                hidden: false,
                color: "not-a-color",
                icon: "not-an-icon",
                customColor: "nope",
            },
        ]);

        expect(layout.find((entry) => entry.id === "approved")).toMatchObject({
            color: "violet",
            icon: "star",
            customColor: "#00ff00",
            defaultExpanded: true,
        });
        expect(layout.find((entry) => entry.id === "drafts")).toMatchObject({
            color: "slate",
            icon: "draft",
            customColor: null,
            defaultExpanded: false,
        });
    });

    it("only exposes visible sections to the board, with blank labels falling back", () => {
        const layout = normalizeSectionLayout([
            { id: "approved", label: "Ship it", hidden: false },
            { id: "drafts", label: "   ", hidden: false },
            { id: "needs-your-review", label: "Review", hidden: true },
        ]);

        expect(visibleSectionDefinitions(layout).map((entry) => entry.id)).not.toContain("needs-your-review");
        expect(visibleSectionDefinitions(layout)[0]).toMatchObject({ id: "approved", label: "Ship it" });
        expect(visibleSectionDefinitions(layout).find((entry) => entry.id === "drafts")?.label).toBe("Drafts");
    });

    it("ships default filters on a fresh layout", () => {
        const layout = defaultSectionLayout();
        expect(layout.find((entry) => entry.id === "needs-your-review")?.filter.cases.length).toBeGreaterThan(0);
        expect(layout.some((entry) => entry.id === "other")).toBe(false);
    });
});

describe("parseInboxSettings", () => {
    it("accepts a versioned document and normalizes layout + expanded defaults", () => {
        const settings = parseInboxSettings({
            version: 2,
            expandedSections: ["drafts", "bogus"],
            sectionLayout: [
                { id: "approved", label: "Ready", hidden: true, color: "rose", icon: "flame", defaultExpanded: false },
                { id: "drafts", label: "Drafts", hidden: false, defaultExpanded: true },
            ],
        });

        expect(settings.expandedSections).toEqual([
            "drafts",
            "needs-your-review",
            "returned-to-you",
            "waiting-for-reviewers-me",
        ]);
        expect(settings.sectionLayout.find((entry) => entry.id === "approved")).toMatchObject({
            label: "Ready",
            hidden: true,
            color: "rose",
            icon: "flame",
            defaultExpanded: false,
        });
        expect(settings.sectionLayout).toHaveLength(DEFAULT_INBOX_SECTIONS.length);
    });

    it("migrates v1 settings and treats other as custom", () => {
        const settings = parseInboxSettings({
            version: 1,
            sectionLayout: [{ id: "other", label: "Misc", hidden: false }],
        });
        expect(settings.version).toBe(2);
        expect(settings.sectionLayout.find((entry) => entry.id === "other")).toMatchObject({
            kind: "custom",
            label: "Misc",
        });
    });

    it("rejects unsupported versions", () => {
        expect(() => parseInboxSettings({ version: 99 })).toThrow(/Unsupported Inbox settings version/);
    });
});

describe("groupIntoSections", () => {
    it("keeps every visible section, including empty ones, and allows overlap", () => {
        const layout = defaultSectionLayout().map((entry) => ({ ...entry, hidden: false }));
        const definitions = visibleSectionDefinitions(layout);
        const sections = groupIntoSections([pullRequest({ reviewRequests: [VIEWER] })], VIEWER, definitions);

        expect(sections).toHaveLength(DEFAULT_INBOX_SECTIONS.length);
        expect(sections.find((section) => section.id === "needs-your-review")?.pullRequests).toHaveLength(1);
        expect(sections.find((section) => section.id === "drafts")?.pullRequests).toHaveLength(0);
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

        const definitions = visibleSectionDefinitions(defaultSectionLayout());
        const needsReview = groupIntoSections([older, newer], VIEWER, definitions).find(
            (section) => section.id === "needs-your-review",
        );

        expect(needsReview?.pullRequests.map((entry) => entry.number)).toEqual([2, 1]);
    });
});
