import { createFileRoute } from "@tanstack/react-router";

import { proxyGithubRequest } from "#/lib/github/proxy.server.ts";

async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
    const splat = params._splat ?? "";
    return proxyGithubRequest(request, `/${splat}`);
}

export const Route = createFileRoute("/api/github/$")({
    server: {
        handlers: {
            GET: handle,
            POST: handle,
            PUT: handle,
            PATCH: handle,
            DELETE: handle,
        },
    },
});
