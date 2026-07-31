import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import type { GithubOAuthTokens } from "#/lib/github/oauth-types.ts";

import { oauthTokensUseRefreshFlow } from "#/lib/github/oauth-types.ts";
import { refreshGithubAccessToken } from "#/lib/github/oauth.server.ts";
import { openGithubSessionPayload, sealGithubSessionPayload } from "#/lib/github/token-crypto.server.ts";

/** Legacy plain access-token cookie for apps without expiring user tokens. */
const LEGACY_ACCESS_COOKIE = "easy-review-gh-token";
const STATE_COOKIE = "easy-review-oauth-state";
/** Encrypted refresh token + expiry metadata (access token stays in the legacy cookie). */
const REFRESH_SESSION_COOKIE = "easy-review-gh-refresh-session";

const LEGACY_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const STATE_MAX_AGE_SECONDS = 60 * 10;
/** Renew access tokens this long before GitHub expires them (~8h). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

type GithubRefreshSession = {
    v: 1;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
};

let refreshInFlight: Promise<string | null> | null = null;
let refreshLockKey: string | null = null;

function cookieBase() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
    };
}

function nowMs(): number {
    return Date.now();
}

function expiresAtFromNow(seconds: number | undefined, fallbackSeconds: number): number {
    return nowMs() + (seconds ?? fallbackSeconds) * 1000;
}

function readRefreshSession(): GithubRefreshSession | null {
    const sealed = getCookie(REFRESH_SESSION_COOKIE);
    if (!sealed) {
        return null;
    }

    const plaintext = openGithubSessionPayload(sealed);
    if (!plaintext) {
        return null;
    }

    try {
        const parsed = JSON.parse(plaintext) as GithubRefreshSession;
        if (parsed.v !== 1 || !parsed.refreshToken || !parsed.accessExpiresAt || !parsed.refreshExpiresAt) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function writeRefreshSession(session: GithubRefreshSession): void {
    const maxAgeSeconds = Math.max(60, Math.floor((session.refreshExpiresAt - nowMs()) / 1000));
    setCookie(REFRESH_SESSION_COOKIE, sealGithubSessionPayload(JSON.stringify(session)), {
        ...cookieBase(),
        maxAge: maxAgeSeconds,
    });
}

function writeLegacyAccessToken(accessToken: string, accessExpiresAt: number | null): void {
    const maxAgeSeconds =
        accessExpiresAt != null
            ? Math.max(60, Math.floor((accessExpiresAt - nowMs()) / 1000))
            : LEGACY_TOKEN_MAX_AGE_SECONDS;

    setCookie(LEGACY_ACCESS_COOKIE, accessToken, { ...cookieBase(), maxAge: maxAgeSeconds });
}

function refreshLockFor(session: GithubRefreshSession): string {
    return `${session.refreshToken}:${session.accessExpiresAt}`;
}

function accessTokenNeedsRefresh(session: GithubRefreshSession | null): boolean {
    if (!session) {
        return false;
    }
    return session.accessExpiresAt - REFRESH_BUFFER_MS <= nowMs();
}

function refreshSessionExpired(session: GithubRefreshSession): boolean {
    return session.refreshExpiresAt <= nowMs();
}

async function refreshAccessTokenLocked(session: GithubRefreshSession): Promise<string | null> {
    const lockKey = refreshLockFor(session);

    if (refreshInFlight && refreshLockKey === lockKey) {
        return refreshInFlight;
    }

    refreshLockKey = lockKey;
    refreshInFlight = (async () => {
        if (refreshSessionExpired(session)) {
            clearGithubAuthSession();
            return null;
        }

        try {
            const tokens = await refreshGithubAccessToken(session.refreshToken);
            persistGithubOAuthTokens(tokens);
            return tokens.accessToken;
        } catch {
            clearGithubAuthSession();
            return null;
        } finally {
            refreshInFlight = null;
            refreshLockKey = null;
        }
    })();

    return refreshInFlight;
}

/** Store tokens after OAuth callback or refresh. */
export function persistGithubOAuthTokens(tokens: GithubOAuthTokens): void {
    if (!oauthTokensUseRefreshFlow(tokens)) {
        deleteCookie(REFRESH_SESSION_COOKIE, cookieBase());
        writeLegacyAccessToken(tokens.accessToken, null);
        return;
    }

    const accessExpiresAt = expiresAtFromNow(tokens.expiresIn, 8 * 60 * 60);
    const refreshExpiresAt = expiresAtFromNow(tokens.refreshTokenExpiresIn, 15897600);

    writeLegacyAccessToken(tokens.accessToken, accessExpiresAt);
    writeRefreshSession({
        v: 1,
        refreshToken: tokens.refreshToken!,
        accessExpiresAt,
        refreshExpiresAt,
    });
}

/**
 * Returns a valid GitHub access token, refreshing proactively when near expiry.
 * Clears the session when refresh is impossible.
 */
export async function ensureGithubAccessToken(): Promise<string | undefined> {
    const legacyAccessToken = getCookie(LEGACY_ACCESS_COOKIE);
    const refreshSession = readRefreshSession();

    if (!legacyAccessToken && !refreshSession) {
        return undefined;
    }

    if (refreshSession && accessTokenNeedsRefresh(refreshSession)) {
        const refreshed = await refreshAccessTokenLocked(refreshSession);
        return refreshed ?? undefined;
    }

    if (legacyAccessToken) {
        return legacyAccessToken;
    }

    if (refreshSession && !refreshSessionExpired(refreshSession)) {
        const refreshed = await refreshAccessTokenLocked(refreshSession);
        return refreshed ?? undefined;
    }

    clearGithubAuthSession();
    return undefined;
}

/** Force a refresh after GitHub returns 401 (revoked/expired access token). */
export async function forceRefreshGithubAccessToken(): Promise<string | undefined> {
    const refreshSession = readRefreshSession();
    if (!refreshSession || refreshSessionExpired(refreshSession)) {
        clearGithubAuthSession();
        return undefined;
    }

    const refreshed = await refreshAccessTokenLocked(refreshSession);
    return refreshed ?? undefined;
}

/** Synchronous read — may return an expired token when refresh flow is enabled; prefer {@link ensureGithubAccessToken}. */
export function readGithubAccessToken(): string | undefined {
    return getCookie(LEGACY_ACCESS_COOKIE);
}

export function setGithubAccessTokenCookie(token: string): void {
    writeLegacyAccessToken(token, null);
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

export function clearGithubAuthSession(): void {
    deleteCookie(LEGACY_ACCESS_COOKIE, cookieBase());
    deleteCookie(REFRESH_SESSION_COOKIE, cookieBase());
    deleteCookie(STATE_COOKIE, cookieBase());
    refreshInFlight = null;
    refreshLockKey = null;
}

export { assertGithubOAuthConfigured, redirectTo } from "#/lib/github/auth-redirect.server.ts";
