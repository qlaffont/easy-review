import { getGithubServerEnv } from "#/lib/github/env.server.ts";

/** Ensure env is loaded (fails fast if OAuth is misconfigured). */
export function assertGithubOAuthConfigured(): void {
    getGithubServerEnv();
}

/**
 * Issue a 302. TanStack Start merges cookies from `setCookie` into the returned response.
 *
 * Build the `Response` by hand rather than `Response.redirect()`: the latter has immutable
 * headers, which Start cannot merge cookies into.
 */
export function redirectTo(location: string): Response {
    return new Response(null, { status: 302, headers: { Location: location } });
}
