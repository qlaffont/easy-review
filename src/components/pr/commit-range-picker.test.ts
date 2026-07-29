import { describe, expect, it } from "vitest";

import type { PullRequestCommit } from "#/lib/session/types.ts";

import {
    COMMIT_RANGE_BASE_VALUE,
    commitRangeTriggerLabel,
    commitRangeTriggerTooltip,
    rangeFromSelectValues,
    selectValuesFromRange,
    toCommitOptions,
} from "#/components/pr/commit-range-picker.tsx";

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
        expect(rangeFromSelectValues(COMMIT_RANGE_BASE_VALUE, "ccc3333", commits, baseSha)).toEqual({ mode: "all" });
        expect(selectValuesFromRange({ mode: "all" }, commits, baseSha)).toEqual({
            from: COMMIT_RANGE_BASE_VALUE,
            to: "ccc3333",
        });
        expect(commitRangeTriggerLabel({ mode: "all" }, commits, baseSha)).toBe("All 3 commits");
    });

    it("isolates a middle commit as parent…commit", () => {
        expect(rangeFromSelectValues("aaa1111", "bbb2222", commits, baseSha)).toEqual({
            mode: "range",
            baseOid: "aaa1111",
            headOid: "bbb2222",
        });
    });

    it("only offers head commits after the selected base", () => {
        expect(toCommitOptions(commits, COMMIT_RANGE_BASE_VALUE).map((entry) => entry.oid)).toEqual([
            "aaa1111",
            "bbb2222",
            "ccc3333",
        ]);
        expect(toCommitOptions(commits, "aaa1111").map((entry) => entry.oid)).toEqual(["bbb2222", "ccc3333"]);
        expect(toCommitOptions(commits, "bbb2222").map((entry) => entry.oid)).toEqual(["ccc3333"]);
    });

    it("shows From/To hashes when a range is selected", () => {
        expect(
            commitRangeTriggerLabel({ mode: "range", baseOid: "aaa1111", headOid: "bbb2222" }, commits, baseSha),
        ).toBe("From: aaa1111 - To: bbb2222");
        expect(
            commitRangeTriggerTooltip({ mode: "range", baseOid: "aaa1111", headOid: "bbb2222" }, commits, baseSha),
        ).toBe("From: aaa1111 · one\nTo: bbb2222 · two");
    });

    it("labels the PR base in the From/To trigger", () => {
        expect(commitRangeTriggerLabel({ mode: "range", baseOid: baseSha, headOid: "bbb2222" }, commits, baseSha)).toBe(
            "From: base000 - To: bbb2222",
        );
        expect(
            commitRangeTriggerTooltip({ mode: "range", baseOid: baseSha, headOid: "bbb2222" }, commits, baseSha),
        ).toBe("From: base000 · Pull request merge base\nTo: bbb2222 · two");
    });
});
