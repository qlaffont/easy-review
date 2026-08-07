import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("@tanstack/react-start/server", () => ({
    getCookie: (name: string) => cookieStore.get(name),
    setCookie: (name: string, value: string) => {
        cookieStore.set(name, value);
    },
    deleteCookie: (name: string) => {
        cookieStore.delete(name);
    },
    getResponseHeaders: () => new Headers(),
}));

const refreshGithubAccessToken = vi.fn();

vi.mock("#/lib/github/oauth.server.ts", () => ({
    refreshGithubAccessToken: (...args: Array<unknown>) => refreshGithubAccessToken(...args),
}));

import {
    clearGithubAuthSession,
    ensureGithubAccessToken,
    persistGithubOAuthTokens,
    readOAuthReturnToCookie,
    setOAuthReturnToCookie,
} from "#/lib/github/auth-cookies.server.ts";
import { resetGithubServerEnvCache } from "#/lib/github/env.server.ts";
import { openGithubSessionPayload, sealGithubSessionPayload } from "#/lib/github/token-crypto.server.ts";

describe("auth-cookies refresh session", () => {
    beforeEach(() => {
        cookieStore.clear();
        refreshGithubAccessToken.mockReset();
        process.env.GITHUB_CLIENT_ID = "Iv1.testclientid000000000000000000";
        process.env.GITHUB_CLIENT_SECRET = "test-client-secret-for-crypto-tests";
        delete process.env.GITHUB_SESSION_SECRET;
        resetGithubServerEnvCache();
    });

    afterEach(() => {
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        delete process.env.GITHUB_SESSION_SECRET;
        resetGithubServerEnvCache();
        clearGithubAuthSession();
    });

    it("stores legacy access token when GitHub omits refresh metadata", async () => {
        persistGithubOAuthTokens({ accessToken: "ghu_legacy" });

        expect(cookieStore.get("easy-review-gh-token")).toBe("ghu_legacy");
        expect(cookieStore.has("easy-review-gh-refresh-session")).toBe(false);
        expect(await ensureGithubAccessToken()).toBe("ghu_legacy");
    });

    it("refreshes proactively when the access token is near expiry", async () => {
        persistGithubOAuthTokens({
            accessToken: "ghu_old",
            refreshToken: "ghr_old",
            expiresIn: 60,
            refreshTokenExpiresIn: 3600,
        });

        const sealed = cookieStore.get("easy-review-gh-refresh-session");
        expect(sealed).toBeTruthy();

        const session = JSON.parse(openGithubSessionPayload(sealed!)!) as {
            accessExpiresAt: number;
            refreshToken: string;
        };
        session.accessExpiresAt = Date.now() + 60_000;
        cookieStore.set("easy-review-gh-refresh-session", sealGithubSessionPayload(JSON.stringify(session)));

        refreshGithubAccessToken.mockResolvedValueOnce({
            accessToken: "ghu_new",
            refreshToken: "ghr_new",
            expiresIn: 28_800,
            refreshTokenExpiresIn: 15_897_600,
        });

        expect(await ensureGithubAccessToken()).toBe("ghu_new");
        expect(refreshGithubAccessToken).toHaveBeenCalledWith("ghr_old");
        expect(cookieStore.get("easy-review-gh-token")).toBe("ghu_new");
    });

    it("stores and reads a sanitized OAuth return path", () => {
        setOAuthReturnToCookie("/pr/acme/api/7?tab=files#review");
        expect(readOAuthReturnToCookie()).toBe("/pr/acme/api/7?tab=files#review");
        setOAuthReturnToCookie("https://evil.test");
        expect(readOAuthReturnToCookie()).toBe("/");
    });
});
