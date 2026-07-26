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

describe("getPullRequest", () => {
    it("keeps the pull request when CheckRun contexts are forbidden to fine-grained PATs", async () => {
        const github = createGithubHttpClient(
            respondWith({
                data: {
                    repository: {
                        mergeCommitAllowed: true,
                        squashMergeAllowed: true,
                        rebaseMergeAllowed: false,
                        viewerDefaultMergeMethod: "SQUASH",
                        pullRequest: {
                            number: 278,
                            title: "Ship checks",
                            url: "https://github.com/latomate/medical-web/pull/278",
                            state: "OPEN",
                            isDraft: true,
                            createdAt: "2026-07-13T16:21:46Z",
                            updatedAt: "2026-07-13T17:22:16Z",
                            mergedAt: null,
                            headRefName: "feature",
                            baseRefName: "dev",
                            additions: 1,
                            deletions: 0,
                            changedFiles: 1,
                            reviewDecision: "REVIEW_REQUIRED",
                            author: { login: "qlaffont", avatarUrl: null },
                            repository: { nameWithOwner: "latomate/medical-web" },
                            comments: { totalCount: 0 },
                            reviewRequests: { nodes: [] },
                            latestReviews: { nodes: [] },
                            body: "",
                            baseRefOid: "base",
                            headRefOid: "head",
                            mergeable: "CONFLICTING",
                            baseRef: {
                                branchProtectionRule: {
                                    requiresApprovingReviews: true,
                                    requiredApprovingReviewCount: 2,
                                },
                            },
                            labels: { nodes: [] },
                            assignees: { nodes: [{ login: "qlaffont" }] },
                            commits: {
                                totalCount: 3,
                                nodes: [
                                    {
                                        commit: {
                                            oid: "head",
                                            statusCheckRollup: {
                                                state: "FAILURE",
                                                contexts: {
                                                    nodes: [
                                                        null,
                                                        null,
                                                        {
                                                            __typename: "StatusContext",
                                                            context: "CodeRabbit",
                                                            state: "SUCCESS",
                                                            targetUrl: null,
                                                        },
                                                    ],
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
                errors: [
                    {
                        type: "FORBIDDEN",
                        message: "Resource not accessible by personal access token",
                    },
                ],
            }),
        );

        const detail = await github.getPullRequest("token", "latomate/medical-web", 278);

        expect(detail.title).toBe("Ship checks");
        expect(detail.checks).toBe("failure");
        expect(detail.checkRuns).toEqual([{ name: "CodeRabbit", state: "success", url: null }]);
        expect(detail.requiredApprovingReviewCount).toBe(2);
        expect(detail.allowedMergeMethods).toEqual(["merge", "squash"]);
        expect(detail.defaultMergeMethod).toBe("squash");
        expect(detail.commitCount).toBe(3);
    });

    it("reads required approving reviews from branch rulesets when classic protection is absent", async () => {
        const github = createGithubHttpClient(async (input) => {
            const url = String(input);

            if (url.includes("/graphql")) {
                return new Response(
                    JSON.stringify({
                        data: {
                            repository: {
                                mergeCommitAllowed: true,
                                squashMergeAllowed: true,
                                rebaseMergeAllowed: true,
                                viewerDefaultMergeMethod: "MERGE",
                                pullRequest: {
                                    ...pullRequestNode("acme/api", 12),
                                    reviewDecision: "REVIEW_REQUIRED",
                                    body: "",
                                    baseRefOid: "base",
                                    headRefOid: "head",
                                    mergeable: "MERGEABLE",
                                    baseRef: { branchProtectionRule: null },
                                    labels: { nodes: [] },
                                    assignees: { nodes: [] },
                                    commits: { totalCount: 1, nodes: [] },
                                },
                            },
                        },
                    }),
                    { status: 200 },
                );
            }

            expect(url).toContain("/repos/acme/api/rules/branches/main");
            return new Response(
                JSON.stringify([
                    {
                        type: "pull_request",
                        parameters: { required_approving_review_count: 1 },
                    },
                ]),
                { status: 200 },
            );
        });

        const detail = await github.getPullRequest("token", "acme/api", 12);

        expect(detail.requiredApprovingReviewCount).toBe(1);
        expect(detail.reviewDecision).toBe("review-required");
    });
});

describe("listRepositories", () => {
    it("uses REST /user/repos so org-scoped fine-grained tokens see organization repos", async () => {
        const github = createGithubHttpClient(async (input) => {
            const url = String(input);
            expect(url).toContain("/user/repos");
            expect(url).toContain("affiliation=owner,collaborator,organization_member");

            return new Response(
                JSON.stringify([
                    {
                        full_name: "latomate/medical-web",
                        name: "medical-web",
                        private: true,
                        archived: false,
                        pushed_at: "2026-07-20T00:00:00Z",
                        owner: { login: "latomate" },
                    },
                    {
                        full_name: "qlaffont/raycast-extensions",
                        name: "raycast-extensions",
                        private: false,
                        archived: false,
                        pushed_at: "2026-07-19T00:00:00Z",
                        owner: { login: "qlaffont" },
                    },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        });

        const repositories = await github.listRepositories("token");

        expect(repositories.map((repository) => repository.nameWithOwner)).toEqual([
            "latomate/medical-web",
            "qlaffont/raycast-extensions",
        ]);
    });
});

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
