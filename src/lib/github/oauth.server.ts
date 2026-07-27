import { getRequestUrl } from "@tanstack/react-start/server";

import { getGithubServerEnv } from "#/lib/github/env.server.ts";
import { GITHUB_OAUTH_SCOPES } from "#/lib/github/oauth-scopes.ts";

export { GITHUB_OAUTH_SCOPES } from "#/lib/github/oauth-scopes.ts";

export function githubOAuthCallbackUrl(): string {
    const url = getRequestUrl();
    return `${url.origin}/api/auth/github/callback`;
}

export function githubAuthorizeUrl(state: string): string {
    const { GITHUB_CLIENT_ID } = getGithubServerEnv();
    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: githubOAuthCallbackUrl(),
        scope: GITHUB_OAUTH_SCOPES,
        state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGithubOAuthCode(code: string): Promise<string> {
    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = getGithubServerEnv();

    const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: githubOAuthCallbackUrl(),
        }),
    });

    if (!response.ok) {
        throw new Error(`GitHub token exchange failed (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
        ? ((await response.json()) as {
              access_token?: string;
              error?: string;
              error_description?: string;
          })
        : Object.fromEntries(new URLSearchParams(await response.text()));

    if (!payload.access_token) {
        throw new Error(payload.error_description ?? payload.error ?? "GitHub did not return an access token.");
    }

    return payload.access_token;
}

export function newOAuthState(): string {
    return crypto.randomUUID();
}
