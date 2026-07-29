import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

import { resolveAppBuildId } from "#/lib/app-version.ts";

const buildId = resolveAppBuildId(import.meta.env.VITE_APP_BUILD_ID);

export const Route = createFileRoute("/api/version")({
    server: {
        handlers: {
            GET: async () => {
                return json(
                    { buildId },
                    {
                        headers: {
                            "Cache-Control": "no-store",
                        },
                    },
                );
            },
        },
    },
});
