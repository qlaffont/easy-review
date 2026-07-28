import { describe, expect, it } from "vitest";

import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";

function respondJson(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
        ...init,
    });
}

describe("listComparedFiles", () => {
    it("maps GitHub compare files into the pull-request file list shape", async () => {
        const github = createGithubHttpClient(async (input) => {
            const url = String(input);
            if (url.includes("/graphql")) {
                return respondJson({ data: {} });
            }
            if (url.includes("/compare/")) {
                expect(url).toContain("/compare/baseoid...headoid");
                return respondJson({
                    truncated: false,
                    files: [
                        {
                            filename: "src/a.ts",
                            status: "modified",
                            additions: 2,
                            deletions: 1,
                        },
                        {
                            filename: "src/b.ts",
                            previous_filename: "src/old-b.ts",
                            status: "renamed",
                            additions: 0,
                            deletions: 0,
                        },
                    ],
                });
            }
            return new Response(`unexpected ${url}`, { status: 500 });
        });

        const files = await github.listComparedFiles("token", "acme/api", "baseoid", "headoid");
        expect(files).toEqual([
            {
                path: "src/a.ts",
                previousPath: null,
                status: "modified",
                additions: 2,
                deletions: 1,
                stub: null,
            },
            {
                path: "src/b.ts",
                previousPath: "src/old-b.ts",
                status: "renamed",
                additions: 0,
                deletions: 0,
                stub: null,
            },
        ]);
    });
});
