import { describe, expect, it } from "vitest";

import type { PullRequestBelow } from "#/lib/session/stack-suggestion.ts";

import { stackSuggestionFor } from "#/lib/session/stack-suggestion.ts";

const current = { number: 682, state: "open" as const, baseRefName: "feat/dmp-documents", inStack: false };

function below(overrides: Partial<PullRequestBelow> = {}): PullRequestBelow {
    return {
        number: 677,
        title: "feat(dmp): afficher la liste des documents",
        url: "https://github.com/latomate/medical-web/pull/677",
        isDraft: false,
        author: "qlaffont",
        headRefName: "feat/dmp-documents",
        baseRefName: "main",
        isCrossRepository: false,
        stack: null,
        ...overrides,
    };
}

describe("stackSuggestionFor", () => {
    it("offers a new stack when the pull request below is not stacked", () => {
        expect(stackSuggestionFor(current, { currentIsCrossRepository: false, candidates: [below()] })).toMatchObject({
            kind: "create",
            pullRequests: [677, 682],
        });
    });

    it("offers to go on top when the pull request below tops a stack", () => {
        const suggestion = stackSuggestionFor(current, {
            currentIsCrossRepository: false,
            candidates: [below({ stack: { number: 4, size: 3, position: 3 } })],
        });

        expect(suggestion).toMatchObject({ kind: "add", stackNumber: 4, pullRequests: [682] });
    });

    it("stays quiet when the pull request below is in the middle of a stack", () => {
        expect(
            stackSuggestionFor(current, {
                currentIsCrossRepository: false,
                candidates: [below({ stack: { number: 4, size: 3, position: 2 } })],
            }),
        ).toBeNull();
    });

    it("stays quiet when the pull request is already stacked, not open, or ambiguous", () => {
        const lookup = { currentIsCrossRepository: false, candidates: [below()] };

        expect(stackSuggestionFor({ ...current, inStack: true }, lookup)).toBeNull();
        expect(stackSuggestionFor({ ...current, state: "merged" }, lookup)).toBeNull();
        expect(
            stackSuggestionFor(current, {
                currentIsCrossRepository: false,
                candidates: [below(), below({ number: 678 })],
            }),
        ).toBeNull();
        expect(stackSuggestionFor(current, { currentIsCrossRepository: false, candidates: [] })).toBeNull();
    });

    it("never stacks across forks", () => {
        expect(stackSuggestionFor(current, { currentIsCrossRepository: true, candidates: [below()] })).toBeNull();
        expect(
            stackSuggestionFor(current, {
                currentIsCrossRepository: false,
                candidates: [below({ isCrossRepository: true })],
            }),
        ).toBeNull();
    });

    it("ignores candidates whose branch is not this pull request's base", () => {
        expect(
            stackSuggestionFor(current, {
                currentIsCrossRepository: false,
                candidates: [below({ headRefName: "feat/other" })],
            }),
        ).toBeNull();
    });
});
