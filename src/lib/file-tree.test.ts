import { describe, expect, it } from "vitest";

import type { PullRequestFile } from "#/lib/session/types.ts";

import {
    buildFileTree,
    defaultExpandedDirPaths,
    filePathsInDisplayOrder,
    filesToReview,
    firstUnviewedPathInDisplayOrder,
    isTestFilePath,
} from "#/lib/file-tree.ts";

function file(path: string, status: PullRequestFile["status"] = "modified"): PullRequestFile {
    return { path, previousPath: null, status, additions: 1, deletions: 0, stub: null };
}

describe("buildFileTree", () => {
    it("groups files under directories and sorts dirs then files", () => {
        const tree = buildFileTree([file("z.txt"), file("src/b.ts"), file("src/a.ts"), file("docs/readme.md")]);

        expect(tree.map((node) => node.name)).toEqual(["docs", "src", "z.txt"]);
        expect(tree[1]).toMatchObject({ kind: "dir", name: "src" });
        if (tree[1]?.kind === "dir") {
            expect(tree[1].children.map((child) => child.name)).toEqual(["a.ts", "b.ts"]);
        }
    });

    it("compacts single-child directory chains", () => {
        const tree = buildFileTree([file("main/kotlin/io/md/Invoice.kt"), file("main/kotlin/io/md/Other.kt")]);

        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({
            kind: "dir",
            name: "main/kotlin/io/md",
        });
        if (tree[0]?.kind === "dir") {
            expect(tree[0].children.map((child) => child.name)).toEqual(["Invoice.kt", "Other.kt"]);
        }
    });

    it("keeps sibling dirs from compacting past a branch", () => {
        const tree = buildFileTree([file("a/b/one.ts"), file("a/c/two.ts")]);
        expect(tree[0]).toMatchObject({ kind: "dir", name: "a" });
        if (tree[0]?.kind === "dir") {
            expect(tree[0].children.map((child) => child.name)).toEqual(["b", "c"]);
        }
    });
});

describe("defaultExpandedDirPaths", () => {
    it("includes every directory path", () => {
        const tree = buildFileTree([file("a/b/c.ts"), file("a/d.ts")]);
        expect([...defaultExpandedDirPaths(tree)].sort()).toEqual(["a", "a/b"]);
    });
});

describe("filePathsInDisplayOrder", () => {
    const files = [file("z.txt"), file("src/b.ts"), file("src/a.ts"), file("docs/readme.md")];

    it("returns API order in flat layout", () => {
        expect(filePathsInDisplayOrder(files, "flat")).toEqual(["z.txt", "src/b.ts", "src/a.ts", "docs/readme.md"]);
    });

    it("returns tree walk order in tree layout", () => {
        expect(filePathsInDisplayOrder(files, "tree")).toEqual(["docs/readme.md", "src/a.ts", "src/b.ts", "z.txt"]);
    });
});

describe("isTestFilePath", () => {
    it.each([
        "src/lib/file-tree.test.ts",
        "app/services/findAct.test.tsx",
        "pkg/server_test.go",
        "pkg/server-test.js",
        "src/main/InvoiceTest.kt",
        "test.ts",
        "src/__snapshots__/view.test.ts.snap",
        "test/helpers.ts",
        "tests/fixtures/data.json",
        "src/test/kotlin/Invoice.kt",
        "src/__tests__/view.tsx",
    ])("treats %s as a test file", (path) => {
        expect(isTestFilePath(path)).toBe(true);
    });

    it.each([
        "src/latest.ts",
        "src/Latest.ts",
        "docs/CONTEST.md",
        "src/attest.config.ts",
        "src/testimonials/list.ts",
        "src/contest/rules.ts",
        "src/test",
        "src/test-utils.ts",
        "src/testing.ts",
    ])("leaves %s alone", (path) => {
        expect(isTestFilePath(path)).toBe(false);
    });
});

describe("filesToReview", () => {
    const files = [file("src/a.ts"), file("src/a.test.ts"), file("tests/b.ts")];

    it("keeps every file while test files are shown", () => {
        expect(filesToReview(files, false)).toBe(files);
    });

    it("drops test files once they are hidden", () => {
        expect(filesToReview(files, true).map((entry) => entry.path)).toEqual(["src/a.ts"]);
    });
});

describe("firstUnviewedPathInDisplayOrder", () => {
    const files = [file("z.txt"), file("src/b.ts"), file("src/a.ts"), file("docs/readme.md")];

    it("returns the first unviewed file in tree order", () => {
        const viewed = new Set(["docs/readme.md", "src/a.ts"]);
        expect(firstUnviewedPathInDisplayOrder(files, "tree", (path) => viewed.has(path))).toBe("src/b.ts");
    });

    it("falls back to the first file when everything is viewed", () => {
        expect(firstUnviewedPathInDisplayOrder(files, "tree", () => true)).toBe("docs/readme.md");
    });
});
