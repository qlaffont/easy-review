import { getRequestUrl } from "@tanstack/react-start/server";

import type { GithubOAuthTokens } from "#/lib/github/oauth-types.ts";

import { getGithubServerEnv } from "#/lib/github/env.server.ts";
import { GITHUB_OAUTH_SCOPES } from "#/lib/github/oauth-scopes.ts";

export { GITHUB_OAUTH_SCOPES } from "#/lib/github/oauth-scopes.ts";

type GithubOAuthTokenPayload = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
};

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

async function requestGithubOAuthTokens(body: Record<string, string>): Promise<GithubOAuthTokens> {
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
            ...body,
        }),
    });

    if (!response.ok) {
        throw new Error(`GitHub token request failed (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
        ? ((await response.json()) as GithubOAuthTokenPayload)
        : (Object.fromEntries(new URLSearchParams(await response.text())) as GithubOAuthTokenPayload);

    if (payload.error) {
        throw new Error(payload.error_description ?? payload.error);
    }

    if (!payload.access_token) {
        throw new Error("GitHub did not return an access token.");
    }

    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresIn: payload.expires_in,
        refreshTokenExpiresIn: payload.refresh_token_expires_in,
        tokenType: payload.token_type,
    };
}

export async function exchangeGithubOAuthCode(code: string): Promise<GithubOAuthTokens> {
    return requestGithubOAuthTokens({
        code,
        redirect_uri: githubOAuthCallbackUrl(),
    });
}

export async function refreshGithubAccessToken(refreshToken: string): Promise<GithubOAuthTokens> {
    return requestGithubOAuthTokens({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
}

export function newOAuthState(): string {
    return crypto.randomUUID();
}
