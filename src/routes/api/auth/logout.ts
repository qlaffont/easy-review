import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

import { clearGithubAuthSession } from "#/lib/github/auth-cookies.server.ts";

export const Route = createFileRoute("/api/auth/logout")({
    server: {
        handlers: {
            POST: async () => {
                clearGithubAuthSession();
                return json({ ok: true });
            },
        },
    },
});
