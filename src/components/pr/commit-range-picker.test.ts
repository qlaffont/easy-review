import { describe, expect, it } from "vitest";

import type { PullRequestCommit } from "#/lib/session/types.ts";

import { rangeFromSelectValues, selectValuesFromRange, toCommitOptions } from "#/components/pr/commit-range-picker.tsx";

function commit(oid: string, headline = oid): PullRequestCommit {
    return {
        oid,
        abbreviatedOid: oid.slice(0, 7),
        messageHeadline: headline,
        committedAt: "2026-01-01T00:00:00.000Z",
        authorLogin: "alice",
        authorAvatarUrl: null,
        url: `https://github.com/acme/api/commit/${oid}`,
        checkState: "success",
    };
}

describe("commit range picker", () => {
    const commits = [commit("aaa1111", "one"), commit("bbb2222", "two"), commit("ccc3333", "three")];
    const baseSha = "base000";

    it("treats base…last as the full pull request", () => {
        expect(rangeFromSelectValues("__base__", "ccc3333", commits, baseSha)).toEqual({ mode: "all" });
        expect(selectValuesFromRange({ mode: "all" }, commits, baseSha)).toEqual({
            from: "__base__",
            to: "ccc3333",
        });
    });

    it("isolates a middle commit as parent…commit", () => {
        expect(rangeFromSelectValues("aaa1111", "bbb2222", commits, baseSha)).toEqual({
            mode: "range",
            baseOid: "aaa1111",
            headOid: "bbb2222",
        });
    });

    it("only offers head commits after the selected base", () => {
        expect(toCommitOptions(commits, "__base__").map((entry) => entry.oid)).toEqual([
            "aaa1111",
            "bbb2222",
            "ccc3333",
        ]);
        expect(toCommitOptions(commits, "aaa1111").map((entry) => entry.oid)).toEqual(["bbb2222", "ccc3333"]);
        expect(toCommitOptions(commits, "bbb2222").map((entry) => entry.oid)).toEqual(["ccc3333"]);
    });
});
