import { afterEach, describe, expect, it } from "vitest";

import { isAllowedGraphqlQuery } from "#/lib/github/proxy-allowlist.server.ts";
import {
    QUERY_COST_ALIAS,
    queryCostReport,
    recordQueryCost,
    resetQueryCosts,
    withQueryCostProbe,
} from "#/lib/github/query-cost.ts";
import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";

afterEach(() => {
    resetQueryCosts();
});

describe("GitHub query cost probe", () => {
    it("adds a free rateLimit probe to named queries, after their variables", () => {
        const probed = withQueryCostProbe(
            "query EasyReviewSectionPullRequests($query: String!, $first: Int!) { search(query: $query) { issueCount } }",
        );

        expect(probed).toContain(`{\n${QUERY_COST_ALIAS}: rateLimit { cost remaining }\n search(`);
        expect(isAllowedGraphqlQuery(probed!)).toBe(true);
        expect(withQueryCostProbe("query EasyReviewViewer { viewer { login } }")).toContain(QUERY_COST_ALIAS);
    });

    it("leaves mutations alone", () => {
        expect(withQueryCostProbe("mutation EasyReviewMerge($id: ID!) { mergePullRequest { clientMutationId } }")).toBe(
            null,
        );
    });

    it("adds up points per operation and page size", () => {
        recordQueryCost({ operation: "EasyReviewSectionPullRequests", first: 10, cost: 1, remaining: 4999 });
        recordQueryCost({ operation: "EasyReviewSectionPullRequests", first: 10, cost: 1, remaining: 4998 });
        recordQueryCost({ operation: "EasyReviewSectionPullRequests", first: 50, cost: 3, remaining: 4995 });

        expect(queryCostReport()).toEqual({
            rows: [
                { operation: "EasyReviewSectionPullRequests (first: 50)", calls: 1, points: 3 },
                { operation: "EasyReviewSectionPullRequests (first: 10)", calls: 2, points: 2 },
            ],
            calls: 3,
            points: 5,
        });
    });

    it("measures through the client without the probe reaching the app", async () => {
        const sent: Array<string> = [];
        const recorded: Array<number> = [];
        const github = createGithubHttpClient(
            (async (_url: string, init: RequestInit) => {
                sent.push(JSON.parse(String(init.body)).query);
                return new Response(
                    JSON.stringify({
                        data: {
                            [QUERY_COST_ALIAS]: { cost: 2, remaining: 4800 },
                            viewer: { login: "octocat", name: null, avatarUrl: "" },
                        },
                    }),
                    { status: 200 },
                );
            }) as unknown as typeof fetch,
            { queryCost: { enabled: () => true, record: (entry) => recorded.push(entry.cost) } },
        );

        const viewer = await github.getViewer("token");

        expect(sent[0]).toContain(QUERY_COST_ALIAS);
        expect(recorded).toEqual([2]);
        expect(viewer).toEqual({ login: "octocat", name: null, avatarUrl: "" });
    });
});
