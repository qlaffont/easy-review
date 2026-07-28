import { createFileRoute } from "@tanstack/react-router";

import { assertGithubOAuthConfigured, redirectTo } from "#/lib/github/auth-cookies.server.ts";
import { getGithubAppInstallUrl } from "#/lib/github/env.server.ts";

export const Route = createFileRoute("/api/auth/github/install")({
    server: {
        handlers: {
            GET: async () => {
                assertGithubOAuthConfigured();
                const installUrl = getGithubAppInstallUrl();
                if (!installUrl) {
                    return redirectTo(
                        `/?authError=${encodeURIComponent(
                            "Set GITHUB_APP_SLUG in .env to the app’s public slug (from github.com/apps/<slug>), then restart. See docs/github-setup.md.",
                        )}`,
                    );
                }
                return redirectTo(installUrl);
            },
        },
    },
});
