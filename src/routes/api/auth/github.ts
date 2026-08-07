import { createFileRoute } from "@tanstack/react-router";

import {
    assertGithubOAuthConfigured,
    redirectTo,
    setOAuthStateCookie,
    setOAuthReturnToCookie,
} from "#/lib/github/auth-cookies.server.ts";
import { githubAuthorizeUrl, newOAuthState } from "#/lib/github/oauth.server.ts";

export const Route = createFileRoute("/api/auth/github")({
    server: {
        handlers: {
            GET: async ({ request }) => {
                assertGithubOAuthConfigured();
                const url = new URL(request.url);
                setOAuthReturnToCookie(url.searchParams.get("returnTo"));
                const state = newOAuthState();
                setOAuthStateCookie(state);
                return redirectTo(githubAuthorizeUrl(state));
            },
        },
    },
});
