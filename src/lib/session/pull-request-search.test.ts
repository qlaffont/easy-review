import { describe, expect, it } from "vitest";

import {
    matchesPullRequestSearchQuery,
    parseGitHubPullRequestUrl,
    parsePullRequestNumberQuery,
} from "#/lib/session/pull-request-search.ts";

describe("parseGitHubPullRequestUrl", () => {
    it("parses common GitHub pull request URL shapes", () => {
        expect(parseGitHubPullRequestUrl("https://github.com/latomate/medical-web/pull/196")).toEqual({
            repository: "latomate/medical-web",
            number: 196,
        });
        expect(parseGitHubPullRequestUrl("https://github.com/latomate/medical-web/pull/196/files")).toEqual({
            repository: "latomate/medical-web",
            number: 196,
        });
        expect(parseGitHubPullRequestUrl("github.com/acme/api/pull/7")).toEqual({
            repository: "acme/api",
            number: 7,
        });
        expect(parseGitHubPullRequestUrl("vsm")).toBeNull();
        expect(parseGitHubPullRequestUrl("#196")).toBeNull();
    });
});

describe("parsePullRequestNumberQuery", () => {
    it("parses bare and hashed numbers", () => {
        expect(parsePullRequestNumberQuery("#196")).toBe(196);
        expect(parsePullRequestNumberQuery("196")).toBe(196);
        expect(parsePullRequestNumberQuery("feat")).toBeNull();
    });
});

describe("matchesPullRequestSearchQuery", () => {
    const pullRequest = {
        key: "latomate/medical-web#196",
        repository: "latomate/medical-web",
        number: 196,
        title: "feat(medication): ajouter une mention libre",
        headRefName: "CU-869bbw1jx_Ajouter-une-mention",
        url: "https://github.com/latomate/medical-web/pull/196",
    };

    it("matches title, branch, number, and pasted URLs", () => {
        expect(matchesPullRequestSearchQuery(pullRequest, "mention libre")).toBe(true);
        expect(matchesPullRequestSearchQuery(pullRequest, "CU-869bbw1jx")).toBe(true);
        expect(matchesPullRequestSearchQuery(pullRequest, "#196")).toBe(true);
        expect(matchesPullRequestSearchQuery(pullRequest, "https://github.com/latomate/medical-web/pull/196")).toBe(
            true,
        );
        expect(matchesPullRequestSearchQuery(pullRequest, "https://github.com/other/repo/pull/1")).toBe(false);
    });
});
