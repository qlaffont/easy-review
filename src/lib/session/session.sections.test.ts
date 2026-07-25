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

    it("reorders sections and can reset to the Graphite defaults", async () => {
        const session = await connectedWithInbox();
        const first = session.getSectionLayout()[0]!.id;

        await session.moveSection(first, "down");
        expect(session.getSectionLayout()[1]?.id).toBe(first);

        await session.resetSectionLayout();
        expect(session.getSectionLayout()[0]?.id).toBe("needs-your-review");
        expect(session.getSectionLayout().every((entry) => !entry.hidden)).toBe(true);
    });
});
