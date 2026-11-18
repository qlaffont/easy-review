import { describe, expect, it } from "vitest";

import { pullRequestLinkTarget } from "#/lib/github-pull-request-link.ts";

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
