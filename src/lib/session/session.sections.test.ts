import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithInbox() {
    const session = createEasyReviewSession({ github, store });
    await session.connect(TOKEN);
    await session.setSelectedRepositories(["acme/api"]);
    await session.loadInbox();
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addRepository(TOKEN, "acme/api");
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 1,
        reviewRequests: ["quentin"],
    });
});

describe("inbox section customization", () => {
    it("hides a section from the board without dropping its classification", async () => {
        const session = await connectedWithInbox();

        await session.setSectionHidden("needs-your-review", true);

        expect(session.getInboxSections().map((section) => section.id)).not.toContain("needs-your-review");
        expect(session.getSectionLayout().find((entry) => entry.id === "needs-your-review")?.hidden).toBe(true);
    });

    it("renames a section and keeps the new label across reload", async () => {
        const session = await connectedWithInbox();
        await session.setSectionLabel("needs-your-review", "My turn");

        const reloaded = createEasyReviewSession({ github, store });
        await reloaded.restore();

        expect(reloaded.getSectionLayout().find((entry) => entry.id === "needs-your-review")?.label).toBe("My turn");
        await reloaded.setSelectedRepositories(["acme/api"]);
        await reloaded.loadInbox();
        expect(reloaded.getInboxSections().find((section) => section.id === "needs-your-review")?.label).toBe(
            "My turn",
        );
    });

    it("reorders visible sections without changing hidden neighbors", async () => {
        const session = await connectedWithInbox();
        await session.setSectionHidden("returned-to-you", true);

        // Visible order starts: needs-your-review, approved, …
        await session.moveSection("approved", "up");

        expect(session.getSectionLayout().map((entry) => entry.id)).toEqual([
            "approved",
            "returned-to-you",
            "needs-your-review",
            "waiting-for-reviewers",
            "drafts",
            "merging-and-recently-merged",
            "waiting-for-author",
            "other",
        ]);
        expect(session.getSectionLayout().find((entry) => entry.id === "returned-to-you")?.hidden).toBe(true);
    });

    it("reorders sections and can reset to the Graphite defaults", async () => {
        const session = await connectedWithInbox();
        const first = session.getSectionLayout()[0]!.id;

        await session.moveSection(first, "down");
        expect(session.getSectionLayout()[1]?.id).toBe(first);

        await session.resetSectionLayout();
        expect(session.getSectionLayout()[0]?.id).toBe("needs-your-review");
        expect(session.getSectionLayout().find((entry) => entry.id === "waiting-for-reviewers")?.hidden).toBe(true);
        expect(
            session
                .getSectionLayout()
                .filter((entry) => entry.id !== "waiting-for-reviewers")
                .every((entry) => !entry.hidden),
        ).toBe(true);
    });

    it("persists default-expanded preference across reload", async () => {
        const session = await connectedWithInbox();
        await session.setSectionDefaultExpanded("drafts", true);
        await session.setSectionDefaultExpanded("approved", false);

        const reloaded = createEasyReviewSession({ github, store });
        await reloaded.restore();

        expect(reloaded.getSectionLayout().find((entry) => entry.id === "drafts")?.defaultExpanded).toBe(true);
        expect(reloaded.getSectionLayout().find((entry) => entry.id === "approved")?.defaultExpanded).toBe(false);
    });

    it("persists color and icon across reload", async () => {
        const session = await connectedWithInbox();
        await session.setSectionColor("needs-your-review", "violet");
        await session.setSectionIcon("needs-your-review", "flame");

        const reloaded = createEasyReviewSession({ github, store });
        await reloaded.restore();

        expect(reloaded.getSectionLayout().find((entry) => entry.id === "needs-your-review")).toMatchObject({
            color: "violet",
            icon: "flame",
            customColor: null,
        });
    });

    it("persists a custom hex color across reload", async () => {
        const session = await connectedWithInbox();
        await session.setSectionCustomColor("approved", "#AbC");

        const reloaded = createEasyReviewSession({ github, store });
        await reloaded.restore();

        expect(reloaded.getSectionLayout().find((entry) => entry.id === "approved")?.customColor).toBe("#aabbcc");
        await session.setSectionColor("approved", "rose");
        expect(session.getSectionLayout().find((entry) => entry.id === "approved")?.customColor).toBeNull();
    });

    it("exports and imports collapse + layout preferences", async () => {
        const session = await connectedWithInbox();
        await session.setSectionHidden("drafts", true);
        await session.setSectionLabel("approved", "Ship it");
        await session.setSectionColor("approved", "rose");
        await session.setSectionIcon("approved", "star");
        await session.toggleSection("drafts");

        const exported = session.getInboxSettings();
        expect(exported.version).toBe(1);
        expect(exported.expandedSections).toContain("drafts");
        expect(exported.expandedSections).toContain("approved");

        await session.importInboxSettings({
            version: 1,
            expandedSections: ["drafts"],
            sectionLayout: [],
        });
        expect(session.state.state.inbox.expandedSections).toEqual(["drafts"]);
        expect(session.getSectionLayout().find((entry) => entry.id === "waiting-for-reviewers")?.hidden).toBe(true);
        expect(
            session
                .getSectionLayout()
                .filter((entry) => entry.id !== "waiting-for-reviewers")
                .every((entry) => !entry.hidden && entry.label),
        ).toBeTruthy();

        await session.importInboxSettings(exported);

        expect(session.getSectionLayout().find((entry) => entry.id === "drafts")?.hidden).toBe(true);
        expect(session.getSectionLayout().find((entry) => entry.id === "approved")).toMatchObject({
            label: "Ship it",
            color: "rose",
            icon: "star",
        });
        expect(session.state.state.inbox.expandedSections).toEqual(exported.expandedSections);
    });
});
