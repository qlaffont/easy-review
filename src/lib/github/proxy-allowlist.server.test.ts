import { describe, expect, it } from "vitest";

import { isAllowedGithubProxyRequest, isAllowedGraphqlQuery } from "#/lib/github/proxy-allowlist.server.ts";

function bodyOf(query: string): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify({ query })).buffer;
}

describe("isAllowedGraphqlQuery", () => {
    it("accepts EasyReview-named operations", () => {
        expect(isAllowedGraphqlQuery("query EasyReviewViewer { viewer { login } }")).toBe(true);
        expect(isAllowedGraphqlQuery("mutation EasyReviewResolveThread($id: ID!) { x }")).toBe(true);
    });

    it("rejects anonymous and foreign named operations", () => {
        expect(isAllowedGraphqlQuery("{ viewer { login } }")).toBe(false);
        expect(isAllowedGraphqlQuery("query Evil { viewer { login } }")).toBe(false);
        expect(
            isAllowedGraphqlQuery("query EasyReviewViewer { viewer { login } } query Other { viewer { login } }"),
        ).toBe(false);
    });

    it("ignores operation-like text inside strings and comments", () => {
        expect(isAllowedGraphqlQuery(`query EasyReviewViewer { field(msg: "query Evil { x }") } # query Evil`)).toBe(
            true,
        );
    });
});

describe("isAllowedGithubProxyRequest", () => {
    it("allows inbox and review REST surfaces", () => {
        expect(isAllowedGithubProxyRequest("POST", "/markdown", new ArrayBuffer(0))).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/user/installations", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/user/installations/42/repositories", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/user/repos", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/repos/acme/api/labels", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("POST", "/repos/acme/api/pulls/1/reviews", new ArrayBuffer(0))).toBe(true);
        expect(isAllowedGithubProxyRequest("PUT", "/repos/acme/api/pulls/1/merge", new ArrayBuffer(0))).toBe(true);
        expect(isAllowedGithubProxyRequest("PATCH", "/repos/acme/api/git/refs/heads/main", new ArrayBuffer(0))).toBe(
            true,
        );
        expect(isAllowedGithubProxyRequest("GET", "/repos/acme/api/contents/src/a.ts", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/repos/acme/api/compare/abc...def", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("GET", "/repos/acme/api/git/ref/uploads/pr/42", undefined)).toBe(true);
        expect(isAllowedGithubProxyRequest("POST", "/repos/acme/api/git/blobs", new ArrayBuffer(0))).toBe(true);
        expect(isAllowedGithubProxyRequest("POST", "/repos/acme/api/git/refs", new ArrayBuffer(0))).toBe(true);
        expect(isAllowedGithubProxyRequest("PATCH", "/repos/acme/api/git/refs/uploads/pr/42", new ArrayBuffer(0))).toBe(
            true,
        );
        expect(isAllowedGithubProxyRequest("GET", "/repos/../user", undefined)).toBe(false);
    });

    it("rejects destructive or unrelated GitHub endpoints", () => {
        expect(isAllowedGithubProxyRequest("DELETE", "/repos/acme/api", new ArrayBuffer(0))).toBe(false);
        expect(isAllowedGithubProxyRequest("GET", "/user", undefined)).toBe(false);
        expect(isAllowedGithubProxyRequest("GET", "/orgs/acme/repos", undefined)).toBe(false);
        expect(isAllowedGithubProxyRequest("PUT", "/user/starred/acme/api", new ArrayBuffer(0))).toBe(false);
        expect(isAllowedGithubProxyRequest("POST", "/repos/acme/api/dispatches", new ArrayBuffer(0))).toBe(false);
        expect(isAllowedGithubProxyRequest("GET", "/repos/../user", undefined)).toBe(false);
        expect(isAllowedGithubProxyRequest("GET", "//evil.com", undefined)).toBe(false);
    });

    it("allows GraphQL only for EasyReview operations", () => {
        expect(
            isAllowedGithubProxyRequest("POST", "/graphql", bodyOf("query EasyReviewViewer { viewer { login } }")),
        ).toBe(true);
        expect(isAllowedGithubProxyRequest("POST", "/graphql", bodyOf("{ viewer { login } }"))).toBe(false);
        expect(isAllowedGithubProxyRequest("GET", "/graphql", undefined)).toBe(false);
    });
});
