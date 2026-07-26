import { describe, expect, it } from "vitest";

import { buildSuggestionComment } from "#/lib/session/suggestion.ts";

describe("buildSuggestionComment", () => {
    it("wraps the replacement in a GitHub suggestion fence", () => {
        expect(buildSuggestionComment("", "return true;")).toBe("```suggestion\nreturn true;\n```");
    });

    it("puts optional prose above the suggestion", () => {
        expect(buildSuggestionComment("Prefer an early return.", "return true;")).toBe(
            "Prefer an early return.\n\n```suggestion\nreturn true;\n```",
        );
    });

    it("strips a trailing newline from the suggested code", () => {
        expect(buildSuggestionComment("", "a\n")).toBe("```suggestion\na\n```");
    });
});
