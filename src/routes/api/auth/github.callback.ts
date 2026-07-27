import { createFileRoute } from "@tanstack/react-router";

import {
    assertGithubOAuthConfigured,
    clearOAuthStateCookie,
    readOAuthStateCookie,
    redirectTo,
    setGithubAccessTokenCookie,
} from "#/lib/github/auth-cookies.server.ts";
import { exchangeGithubOAuthCode } from "#/lib/github/oauth.server.ts";

export const Route = createFileRoute("/api/auth/github/callback")({
    server: {
        handlers: {
            GET: async ({ request }) => {
                assertGithubOAuthConfigured();

                const url = new URL(request.url);
                const origin = url.origin;
                const error = url.searchParams.get("error");
                const errorDescription = url.searchParams.get("error_description");

                if (error) {
                    clearOAuthStateCookie();
                    const message = encodeURIComponent(errorDescription ?? error);
                    return redirectTo(`${origin}/?authError=${message}`);
                }

                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state");
                const expectedState = readOAuthStateCookie();

                if (!code || !state || !expectedState || state !== expectedState) {
                    clearOAuthStateCookie();
                    return redirectTo(
                        `${origin}/?authError=${encodeURIComponent("OAuth state mismatch. Try signing in again.")}`,
                    );
                }

                try {
                    const accessToken = await exchangeGithubOAuthCode(code);
                    clearOAuthStateCookie();
                    setGithubAccessTokenCookie(accessToken);
                    return redirectTo(`${origin}/`);
                } catch (cause) {
                    clearOAuthStateCookie();
                    const message = cause instanceof Error ? cause.message : "GitHub sign-in failed.";
                    return redirectTo(`${origin}/?authError=${encodeURIComponent(message)}`);
                }
            },
        },
    },
});
