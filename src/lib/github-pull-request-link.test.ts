import { describe, expect, it } from "vitest";

import { pullRequestLinkTarget, pullRequestReferenceLabel } from "#/lib/github-pull-request-link.ts";

describe("pullRequestLinkTarget", () => {
    it("maps a GitHub pull request URL to route params", () => {
        expect(pullRequestLinkTarget("https://github.com/latomate/medical-service/pull/500")).toEqual({
            owner: "latomate",
            repo: "medical-service",
            number: "500",
        });
    });

    it("ignores a trailing slash, query and fragment", () => {
        expect(pullRequestLinkTarget("https://www.github.com/a/b.c/pull/7/?x=1#issuecomment-1")).toEqual({
            owner: "a",
            repo: "b.c",
            number: "7",
        });
    });

    it.each([
        undefined,
        "not a url",
        "http://github.com/a/b/pull/1",
        "https://gitlab.com/a/b/pull/1",
        "https://github.com/a/b/issues/1",
        "https://github.com/a/b/pull/1/files",
        "https://github.com/a/b/pull/0",
        "https://github.com/a/b/pull/abc",
        "https://github.com/-a/b/pull/1",
    ])("leaves %s alone", (href) => {
        expect(pullRequestLinkTarget(href)).toBeNull();
    });
});

describe("pullRequestReferenceLabel", () => {
    const target = { owner: "latomate", repo: "medical-service", number: "469" };

    it("shortens to #N inside the same repository", () => {
        expect(pullRequestReferenceLabel(target, "latomate/medical-service")).toBe("#469");
        expect(pullRequestReferenceLabel(target, "Latomate/Medical-Service")).toBe("#469");
    });

    it("keeps owner/repo across repositories or without one", () => {
        expect(pullRequestReferenceLabel(target, "latomate/manager-odaiji")).toBe("latomate/medical-service#469");
        expect(pullRequestReferenceLabel(target, null)).toBe("latomate/medical-service#469");
    });
});
