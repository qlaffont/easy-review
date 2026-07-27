import { deleteCookie, getCookie, getResponseHeaders, setCookie } from "@tanstack/react-start/server";

import { getGithubServerEnv } from "#/lib/github/env.server.ts";

const TOKEN_COOKIE = "easy-review-gh-token";
const STATE_COOKIE = "easy-review-oauth-state";
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const STATE_MAX_AGE_SECONDS = 60 * 10;

function cookieBase() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
    };
}

/** Ensure env is loaded (fails fast if OAuth is misconfigured). */
export function assertGithubOAuthConfigured(): void {
    getGithubServerEnv();
}

export function setOAuthStateCookie(state: string): void {
    setCookie(STATE_COOKIE, state, { ...cookieBase(), maxAge: STATE_MAX_AGE_SECONDS });
}

export function readOAuthStateCookie(): string | undefined {
    return getCookie(STATE_COOKIE);
}

export function clearOAuthStateCookie(): void {
    deleteCookie(STATE_COOKIE, cookieBase());
}

export function setGithubAccessTokenCookie(token: string): void {
    setCookie(TOKEN_COOKIE, token, { ...cookieBase(), maxAge: TOKEN_MAX_AGE_SECONDS });
}

export function readGithubAccessToken(): string | undefined {
    return getCookie(TOKEN_COOKIE);
}

export function clearGithubAuthSession(): void {
    deleteCookie(TOKEN_COOKIE, cookieBase());
    deleteCookie(STATE_COOKIE, cookieBase());
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
