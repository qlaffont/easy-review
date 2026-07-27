import { createFileRoute } from "@tanstack/react-router";

import { proxyGithubRequest } from "#/lib/github/proxy.server.ts";

export const Route = createFileRoute("/api/github/graphql")({
    server: {
        handlers: {
            POST: async ({ request }) => proxyGithubRequest(request, "/graphql"),
        },
    },
});
