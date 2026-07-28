import { describe, expect, it } from "vitest";

import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";

type GraphqlBody = { data?: unknown; errors?: Array<{ type?: string; message: string }> };

function respondJson(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
        ...init,
    });
}

describe("uploadPullRequestMedia", () => {
    it("stores media on a hidden uploads ref and returns raw blob markdown", async () => {
        const calls: Array<{ method: string; path: string }> = [];

        const github = createGithubHttpClient(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toUpperCase();

            if (url.includes("/graphql")) {
                return respondJson({ data: {} } satisfies GraphqlBody);
            }

            const path = url.replace(/^https?:\/\/[^/]+/, "");
            calls.push({ method, path });

            if (method === "GET" && path.includes("/git/ref/uploads/pr/42")) {
                return new Response("Not Found", { status: 404 });
            }
            if (method === "POST" && path.endsWith("/git/blobs")) {
                return respondJson({ sha: "blob-sha" }, { status: 201 });
            }
            if (method === "POST" && path.endsWith("/git/trees")) {
                return respondJson({ sha: "tree-sha" }, { status: 201 });
            }
            if (method === "POST" && path.endsWith("/git/commits")) {
                return respondJson({ sha: "commit-sha" }, { status: 201 });
            }
            if (method === "POST" && path.endsWith("/git/refs")) {
                return respondJson({ ref: "refs/uploads/pr/42" }, { status: 201 });
            }

            return new Response(`unexpected ${method} ${path}`, { status: 500 });
        });

        const result = await github.uploadPullRequestMedia("token", {
            repository: "acme/api",
            number: 42,
            fileName: "shot.png",
            contentType: "image/png",
            bytes: new Uint8Array([1, 2, 3, 4]),
        });

        expect(result.url).toMatch(
            /^https:\/\/github\.com\/acme\/api\/blob\/commit-sha\/[a-f0-9]{12}-shot%2Epng\?raw=true$/,
        );
        expect(result.markdown).toBe(`![shot.png](${result.url})`);
        expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/git/refs"))).toBe(true);
    });

    it("explains Contents write when GitHub forbids the upload", async () => {
        const github = createGithubHttpClient(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toUpperCase();
            if (url.includes("/graphql")) {
                return respondJson({ data: {} } satisfies GraphqlBody);
            }
            if (method === "GET" && url.includes("/git/ref/")) {
                return new Response("Not Found", { status: 404 });
            }
            return new Response("Forbidden", { status: 403 });
        });

        await expect(
            github.uploadPullRequestMedia("token", {
                repository: "acme/api",
                number: 42,
                fileName: "shot.png",
                contentType: "image/png",
                bytes: new Uint8Array([1, 2, 3, 4]),
            }),
        ).rejects.toMatchObject({
            kind: "forbidden",
            message: expect.stringContaining("Contents"),
        });
    });
});
