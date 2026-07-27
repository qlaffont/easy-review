import { createFileRoute } from "@tanstack/react-router";

import { assertGithubOAuthConfigured, redirectTo, setOAuthStateCookie } from "#/lib/github/auth-cookies.server.ts";
import { githubAuthorizeUrl, newOAuthState } from "#/lib/github/oauth.server.ts";

export const Route = createFileRoute("/api/auth/github")({
    server: {
        handlers: {
            GET: async () => {
                assertGithubOAuthConfigured();
                const state = newOAuthState();
                setOAuthStateCookie(state);
                return redirectTo(githubAuthorizeUrl(state));
            },
        },
    },
});
