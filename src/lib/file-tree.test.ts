import { describe, expect, it } from "vitest";

import type { PullRequestFile } from "#/lib/session/types.ts";

import { buildFileTree, defaultExpandedDirPaths } from "#/lib/file-tree.ts";

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
