import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedSession() {
    const session = createEasyReviewSession({ github, store });
    await session.connect(TOKEN);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addPullRequest(TOKEN, { repository: "acme/api", number: 1, title: "Ship diffs" });
    github.setPullRequestFiles(TOKEN, "acme/api", 1, [
        {
            path: "src/a.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            before: " console.log(1)\n",
            after: "console.log(2)\n",
        },
        {
            path: "src/b.ts",
            status: "added",
            additions: 1,
            deletions: 0,
            after: "export const b = 1\n",
        },
        {
            path: "package-lock.json",
            status: "modified",
            additions: 100,
            deletions: 100,
            before: "{}\n",
            after: '{ "lockfileVersion": 3 }\n',
        },
        {
            path: "assets/logo.png",
            status: "added",
            additions: 0,
            deletions: 0,
            afterBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]),
        },
    ]);
});

describe("file list", () => {
    it("loads path metadata without fetching any file diff", async () => {
        const session = await connectedSession();

        await session.loadPullRequestFiles("acme/api", 1);

        const page = session.getPullRequestPage("acme/api", 1);
        expect(page.files.status).toBe("ready");
        expect(page.files.items.map((file) => file.path)).toEqual([
            "src/a.ts",
            "src/b.ts",
            "package-lock.json",
            "assets/logo.png",
        ]);
        expect(page.files.items.find((file) => file.path === "package-lock.json")?.stub).toBe("generated");
        expect(page.files.items.find((file) => file.path === "assets/logo.png")?.stub).toBe("binary");
        expect(github.fileDiffQueries).toEqual([]);
        expect(github.calls.filter((call) => call === "listPullRequestFiles")).toHaveLength(1);
    });

    it("drops cached diffs when the file list is refreshed", async () => {
        const session = await connectedSession();
        await session.loadPullRequestFiles("acme/api", 1);
        await session.loadFileDiff("acme/api", 1, "src/a.ts");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").status).toBe("ready");

        await session.refreshPullRequestFiles("acme/api", 1);

        expect(session.getFileDiff("acme/api", 1, "src/a.ts").status).toBe("idle");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").diff).toBeNull();

        // Review UI must load the open file again after a list refresh (same selected path).
        await session.loadFileDiff("acme/api", 1, "src/a.ts");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").status).toBe("ready");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").diff?.lines.some((line) => line.kind === "add")).toBe(
            true,
        );
        expect(github.fileDiffQueries.filter((path) => path === "src/a.ts")).toHaveLength(2);
    });

    it("does not refetch a warm file list", async () => {
        const session = await connectedSession();
        await session.loadPullRequestFiles("acme/api", 1);

        await session.loadPullRequestFiles("acme/api", 1);

        expect(github.calls.filter((call) => call === "listPullRequestFiles")).toHaveLength(1);
    });
});

describe("lazy file diffs", () => {
    it("fetches only the file the reviewer opened", async () => {
        const session = await connectedSession();
        await session.loadPullRequestFiles("acme/api", 1);

        await session.loadFileDiff("acme/api", 1, "src/a.ts");

        expect(github.fileDiffQueries).toEqual(["src/a.ts"]);
        const diff = session.getFileDiff("acme/api", 1, "src/a.ts");
        expect(diff.status).toBe("ready");
        expect(diff.diff?.stub).toBeNull();
        expect(diff.diff?.lines.some((line) => line.kind === "add")).toBe(true);
        expect(session.getFileDiff("acme/api", 1, "src/b.ts").status).toBe("idle");
    });

    it("does not require loading every file to review one of them", async () => {
        const session = await connectedSession();

        await session.loadFileDiff("acme/api", 1, "src/b.ts");

        expect(github.fileDiffQueries).toEqual(["src/b.ts"]);
        expect(github.calls.includes("listPullRequestFiles")).toBe(false);
    });

    it("keeps generated files stubbed until force is set", async () => {
        const session = await connectedSession();

        await session.loadFileDiff("acme/api", 1, "package-lock.json");
        expect(session.getFileDiff("acme/api", 1, "package-lock.json").diff?.stub).toBe("generated");
        expect(github.fileDiffQueries).toEqual(["package-lock.json"]);

        await session.loadFileDiff("acme/api", 1, "package-lock.json", { force: true });
        expect(session.getFileDiff("acme/api", 1, "package-lock.json").diff?.stub).toBeNull();
        expect(github.fileDiffQueries).toEqual(["package-lock.json", "package-lock.json"]);
    });

    it("never expands a binary file, even with force", async () => {
        const session = await connectedSession();

        await session.loadFileDiff("acme/api", 1, "assets/logo.png", { force: true });

        expect(session.getFileDiff("acme/api", 1, "assets/logo.png").diff?.stub).toBe("binary");
    });

    it("reuses a warm text diff without calling GitHub again", async () => {
        const session = await connectedSession();
        await session.loadFileDiff("acme/api", 1, "src/a.ts");

        await session.loadFileDiff("acme/api", 1, "src/a.ts");

        expect(github.fileDiffQueries).toEqual(["src/a.ts"]);
    });
});

describe("applySuggestions", () => {
    it("commits a suggestion onto the head file and refreshes the diff", async () => {
        const session = await connectedSession();
        await session.loadPullRequest("acme/api", 1);
        await session.loadFileDiff("acme/api", 1, "src/a.ts");

        await session.applySuggestions("acme/api", 1, {
            message: "Update src/a.ts",
            changes: [
                {
                    path: "src/a.ts",
                    startLine: 1,
                    endLine: 1,
                    replacement: "console.log(3)",
                    original: "console.log(2)",
                },
            ],
        });

        expect(github.calls).toContain("applySuggestions");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").status).toBe("idle");

        await session.loadFileDiff("acme/api", 1, "src/a.ts");
        expect(session.getFileDiff("acme/api", 1, "src/a.ts").diff?.afterText).toBe("console.log(3)\n");
    });
});
