import { describe, expect, it } from "vitest";

import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";
import { EasyReviewError } from "#/lib/session/errors.ts";

type GraphqlBody = { data?: unknown; errors?: Array<{ type?: string; message: string }> };

function respondWith(body: GraphqlBody, init?: ResponseInit): typeof fetch {
    return (async () => new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch;
}

function pullRequestNode(repository: string, number: number) {
    return {
        number,
        title: `Pull request ${number}`,
        url: `https://github.com/${repository}/pull/${number}`,
        state: "OPEN",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        mergedAt: null,
        headRefName: "feature",
        baseRefName: "main",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        reviewDecision: null,
        author: { login: "octocat", avatarUrl: null },
        repository: { nameWithOwner: repository },
        comments: { totalCount: 0 },
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
        commits: { nodes: [] },
    };
}

describe("listPullRequests", () => {
    it("keeps the repositories that resolved when one of them is unreadable", async () => {
        const github = createGithubHttpClient(
            respondWith({
                data: {
                    repo0: { open: { nodes: [pullRequestNode("acme/api", 1)] }, merged: { nodes: [] } },
                    repo1: null,
                },
                errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository." }],
            }),
        );

        const pullRequests = await github.listPullRequests("token", ["acme/api", "acme/gone"]);

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["acme/api#1"]);
    });

    it("fails the whole load when the token itself is rate limited", async () => {
        const github = createGithubHttpClient(
            respondWith({
                data: { repo0: null },
                errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded." }],
            }),
        );

        await expect(github.listPullRequests("token", ["acme/api"])).rejects.toMatchObject({
            kind: "rate-limited",
        });
    });

    it("surfaces the error when nothing at all resolved", async () => {
        const github = createGithubHttpClient(
            respondWith({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository." }] }),
        );

        await expect(github.listPullRequests("token", ["acme/gone"])).rejects.toBeInstanceOf(EasyReviewError);
    });
});
