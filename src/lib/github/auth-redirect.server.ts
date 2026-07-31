import { getResponseHeaders } from "@tanstack/react-start/server";

import { getGithubServerEnv } from "#/lib/github/env.server.ts";

/** Ensure env is loaded (fails fast if OAuth is misconfigured). */
export function assertGithubOAuthConfigured(): void {
    getGithubServerEnv();
}

/**
 * Issue a 302 and attach any pending Set-Cookie headers from `setCookie` above.
 *
 * Node marks redirect `Response`s as `ok: false` with immutable headers; TanStack crashes if it
 * tries to merge event cookies into them. Copy cookies onto a fresh Headers map first.
 */
export function redirectTo(location: string): Response {
    const eventHeaders = getResponseHeaders();
    const cookies = typeof eventHeaders.getSetCookie === "function" ? eventHeaders.getSetCookie() : [];

    const headers = new Headers({ Location: location });
    for (const cookie of cookies) {
        headers.append("Set-Cookie", cookie);
    }

    eventHeaders.delete("set-cookie");

    return new Response(null, { status: 302, headers });
}
