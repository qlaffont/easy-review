import { describe, expect, it } from "vitest";

import { createGithubHttpClient, resolveReviewRequestPayload } from "#/lib/session/adapters/github-http-client.ts";
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
        totalCommentsCount: 0,
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
        commits: { nodes: [] },
        labels: { nodes: [] },
        assignees: { nodes: [] },
    };
}

describe("getPullRequest", () => {
    it("keeps the pull request when CheckRun contexts are forbidden", async () => {
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
                            totalCommentsCount: 7,
                            reviewRequests: { nodes: [] },
                            latestReviews: { nodes: [] },
                            body: "",
                            reactionGroups: [],
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
                                                    totalCount: 7,
                                                    nodes: [
                                                        null,
                                                        null,
                                                        null,
                                                        null,
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
        expect(detail.checkRuns).toEqual([{ name: "CodeRabbit", state: "success", url: null, summary: "Successful" }]);
        // Suite totals, not readable StatusContext-only nodes (forbidden CheckRuns strip out).
        expect(detail.checkCount).toBe(6);
        expect(detail.requiredApprovingReviewCount).toBe(2);
        expect(detail.allowedMergeMethods).toEqual(["merge", "squash"]);
        expect(detail.defaultMergeMethod).toBe("squash");
        expect(detail.commitCount).toBe(3);
        expect(detail.commentCount).toBe(7);
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
    it("lists repos from each GitHub App installation the user can access", async () => {
        const github = createGithubHttpClient(async (input) => {
            const url = String(input);

            if (url.includes("/user/installations?") || url.endsWith("/user/installations")) {
                return new Response(
                    JSON.stringify({
                        installations: [{ id: 11 }, { id: 22 }],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            if (url.includes("/user/installations/11/repositories")) {
                return new Response(
                    JSON.stringify({
                        repositories: [
                            {
                                full_name: "latomate/medical-web",
                                name: "medical-web",
                                private: true,
                                archived: false,
                                pushed_at: "2026-07-20T00:00:00Z",
                                owner: { login: "latomate" },
                            },
                        ],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            if (url.includes("/user/installations/22/repositories")) {
                return new Response(
                    JSON.stringify({
                        repositories: [
                            {
                                full_name: "acme/platform",
                                name: "platform",
                                private: true,
                                archived: false,
                                pushed_at: "2026-07-21T00:00:00Z",
                                owner: { login: "acme" },
                            },
                            {
                                full_name: "qlaffont/raycast-extensions",
                                name: "raycast-extensions",
                                private: false,
                                archived: false,
                                pushed_at: "2026-07-19T00:00:00Z",
                                owner: { login: "qlaffont" },
                            },
                        ],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            throw new Error(`Unexpected URL: ${url}`);
        });

        const repositories = await github.listRepositories("token");

        expect(repositories.map((repository) => repository.nameWithOwner)).toEqual([
            "acme/platform",
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

describe("searchPullRequests", () => {
    it("maps GraphQL search hits and skips non-PR nodes", async () => {
        const hit = pullRequestNode("latomate/medical-web", 158);
        hit.title = "feat(vsm): revert VSM IPS 2024 till DMP is ready";

        const github = createGithubHttpClient(
            respondWith({
                data: {
                    search: {
                        nodes: [hit, {}],
                    },
                },
            }),
        );

        const pullRequests = await github.searchPullRequests("token", {
            query: "vsm",
            repositories: ["latomate/medical-web"],
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["latomate/medical-web#158"]);
        expect(pullRequests[0]?.title).toContain("vsm");
    });

    it("returns an empty list when no repositories are selected", async () => {
        let calls = 0;
        const github = createGithubHttpClient(async () => {
            calls += 1;
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        });

        await expect(github.searchPullRequests("token", { query: "vsm", repositories: [] })).resolves.toEqual([]);
        expect(calls).toBe(0);
    });

    it("returns an empty list for a blank query without calling GitHub", async () => {
        let calls = 0;
        const github = createGithubHttpClient(async () => {
            calls += 1;
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        });

        await expect(github.searchPullRequests("token", { query: "   ", repositories: ["acme/api"] })).resolves.toEqual(
            [],
        );
        expect(calls).toBe(0);
    });

    it("looks up a pasted GitHub pull request URL", async () => {
        const hit = pullRequestNode("latomate/medical-web", 196);
        hit.title = "feat(medication): ajouter une mention libre";
        hit.state = "MERGED";

        const github = createGithubHttpClient(
            respondWith({
                data: {
                    repo0: { pullRequest: hit },
                },
            }),
        );

        const pullRequests = await github.searchPullRequests("token", {
            query: "https://github.com/latomate/medical-web/pull/196",
            repositories: [],
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["latomate/medical-web#196"]);
    });

    it("looks up bare PR numbers across selected repositories", async () => {
        const hit = pullRequestNode("latomate/medical-web", 196);
        hit.title = "feat(medication): ajouter une mention libre";
        hit.state = "MERGED";

        const github = createGithubHttpClient(
            respondWith({
                data: {
                    repo0: { pullRequest: hit },
                    repo1: { pullRequest: null },
                },
            }),
        );

        const pullRequests = await github.searchPullRequests("token", {
            query: "#196",
            repositories: ["latomate/medical-web", "latomate/medical-service"],
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["latomate/medical-web#196"]);
        expect(pullRequests[0]?.state).toBe("merged");
    });

    it("keeps only title or head-branch substring matches, newest first", async () => {
        const titleHit = pullRequestNode("acme/api", 1);
        titleHit.title = "feat(vsm): add import";
        titleHit.headRefName = "feature/other";
        titleHit.updatedAt = "2026-07-01T00:00:00.000Z";

        const branchHit = pullRequestNode("acme/api", 2);
        branchHit.title = "unrelated title";
        branchHit.headRefName = "feature/vsm-import";
        branchHit.updatedAt = "2026-07-20T00:00:00.000Z";

        const miss = pullRequestNode("acme/api", 3);
        miss.title = "docs: readme";
        miss.headRefName = "docs/readme";
        miss.updatedAt = "2026-07-25T00:00:00.000Z";

        const github = createGithubHttpClient(
            respondWith({
                data: {
                    search: {
                        nodes: [titleHit, branchHit, miss],
                    },
                },
            }),
        );

        const pullRequests = await github.searchPullRequests("token", {
            query: "vsm",
            repositories: ["acme/api"],
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["acme/api#2", "acme/api#1"]);
    });
});

describe("listRelatedPullRequests", () => {
    it("returns open and merged siblings that match head and base refs via search", async () => {
        const matching = pullRequestNode("acme/web", 2);
        matching.headRefName = "feature/foo";
        matching.baseRefName = "main";
        matching.updatedAt = "2026-07-20T00:00:00.000Z";

        const wrongBranch = pullRequestNode("acme/web", 3);
        wrongBranch.headRefName = "other";
        wrongBranch.baseRefName = "main";

        const staleMerged = pullRequestNode("acme/docs", 115);
        staleMerged.headRefName = "feature/foo";
        staleMerged.baseRefName = "main";
        staleMerged.state = "MERGED";
        staleMerged.updatedAt = "2024-06-19T00:00:00.000Z";

        const github = createGithubHttpClient(
            respondWith({
                data: {
                    search: {
                        nodes: [matching, wrongBranch, staleMerged],
                    },
                },
            }),
        );

        const pullRequests = await github.listRelatedPullRequests("token", {
            repositories: ["acme/web", "acme/docs"],
            headRefName: "feature/foo",
            baseRefName: "main",
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["acme/web#2", "acme/docs#115"]);
    });

    it("keeps successful batches when a later batch gets a gateway error", async () => {
        let calls = 0;
        const matching = pullRequestNode("acme/web", 2);
        matching.headRefName = "feature/foo";
        matching.baseRefName = "main";
        matching.updatedAt = "2026-07-20T00:00:00.000Z";

        const github = createGithubHttpClient(async () => {
            calls += 1;
            if (calls === 1) {
                return new Response(
                    JSON.stringify({
                        data: {
                            search: {
                                nodes: [matching],
                            },
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            return new Response("bad gateway", { status: 502 });
        });

        const pullRequests = await github.listRelatedPullRequests("token", {
            repositories: [
                "acme/web",
                "acme/a",
                "acme/b",
                "acme/c",
                "acme/d",
                "acme/e",
                "acme/f",
                "acme/g",
                "acme/h",
                "acme/i",
                "acme/j",
            ],
            headRefName: "feature/foo",
            baseRefName: "main",
        });

        expect(pullRequests.map((pullRequest) => pullRequest.key)).toEqual(["acme/web#2"]);
        expect(calls).toBeGreaterThan(1);
    });
});

describe("getPullRequestFileDiff", () => {
    it("reads the head side via refs/pull/N/head so fork PR commits resolve", async () => {
        const requests: Array<string> = [];
        const github = createGithubHttpClient(async (input, init) => {
            const url = String(input);
            requests.push(url);

            if (init?.method === "POST" || url.includes("/graphql")) {
                return new Response(
                    JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: { baseRefOid: "baseoid", headRefOid: "headoid" },
                            },
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            if (url.includes("ref=headoid")) {
                return new Response("{}", { status: 404 });
            }

            if (url.includes(`ref=${encodeURIComponent("refs/pull/278/head")}`)) {
                return new Response(
                    JSON.stringify({
                        type: "file",
                        encoding: "base64",
                        size: 6,
                        content: btoa("a\nb\nc\n"),
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            if (url.includes("ref=baseoid")) {
                return new Response("{}", { status: 404 });
            }

            throw new Error(`unexpected request: ${url}`);
        });

        const diff = await github.getPullRequestFileDiff(
            "token",
            "latomate/medical-web",
            278,
            "app/features/Prescriptions/Prescriptions.tsx",
        );

        expect(requests.some((url) => url.includes(encodeURIComponent("refs/pull/278/head")))).toBe(true);
        expect(diff.stub).toBeNull();
        expect(diff.lines.some((line) => line.kind === "add" && line.text === "a")).toBe(true);
        expect(diff.lines.filter((line) => line.kind === "add")).toHaveLength(3);
    });

    it("percent-encodes dots in content paths so the same-origin proxy is not stolen by Vite", async () => {
        const requests: Array<string> = [];
        const github = createGithubHttpClient(
            async (input, init) => {
                const url = String(input);
                requests.push(url);

                if (init?.method === "POST" || url.includes("/graphql")) {
                    return new Response(
                        JSON.stringify({
                            data: {
                                repository: {
                                    pullRequest: { baseRefOid: "baseoid", headRefOid: "headoid" },
                                },
                            },
                        }),
                        { status: 200, headers: { "content-type": "application/json" } },
                    );
                }

                if (url.includes("useAutoInsRetrieval%2Ets") && url.includes("ref=baseoid")) {
                    return new Response("{}", { status: 404 });
                }

                if (url.includes("useAutoInsRetrieval%2Ets")) {
                    return new Response(
                        JSON.stringify({
                            type: "file",
                            encoding: "base64",
                            size: 4,
                            content: btoa("ok\n"),
                        }),
                        { status: 200, headers: { "content-type": "application/json" } },
                    );
                }

                throw new Error(`unexpected request: ${url}`);
            },
            { restBaseUrl: "/api/github" },
        );

        const diff = await github.getPullRequestFileDiff(
            "token",
            "latomate/medical-web",
            278,
            "app/features/Messaging/hooks/useAutoInsRetrieval.ts",
        );

        expect(requests.some((url) => /useAutoInsRetrieval\.ts(?:\?|$)/.test(url))).toBe(false);
        expect(requests.some((url) => url.includes("useAutoInsRetrieval%2Ets"))).toBe(true);
        expect(diff.lines.some((line) => line.kind === "add" && line.text === "ok")).toBe(true);
    });
});

describe("resolveReviewRequestPayload", () => {
    const current = {
        users: [{ login: "hubot" }],
        teams: [{ name: "Justice League", slug: "justice-league" }],
    };

    it("routes pending users and teams to the correct REST fields", () => {
        expect(resolveReviewRequestPayload(["hubot", "Justice League"], current)).toEqual({
            all: { reviewers: ["hubot"], team_reviewers: ["justice-league"] },
            pending: { reviewers: ["hubot"], team_reviewers: ["justice-league"] },
        });
    });

    it("treats unknown identifiers as user logins when re-requesting after a review", () => {
        expect(resolveReviewRequestPayload(["mona"], current, { treatUnknownAsUserLogins: true })).toEqual({
            all: { reviewers: ["mona"], team_reviewers: [] },
            pending: { reviewers: [], team_reviewers: [] },
        });
    });
});
