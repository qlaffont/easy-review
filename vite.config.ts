import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

function appBuildId(): string {
    return (
        process.env.VITE_APP_BUILD_ID ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.CF_PAGES_COMMIT_SHA ||
        process.env.GITHUB_SHA ||
        `build-${Date.now()}`
    );
}

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    define: {
        "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(appBuildId()),
    },
    ssr: {
        // Mermaid + Shiki are browser-only (dynamic import). Keep them out of the SSR graph.
        external: ["mermaid", "shiki"],
    },
    plugins: [
        devtools(),
        nitro({
            rollupConfig: {
                external: [/^@sentry\//, /^mermaid($|\/)/, /^shiki($|\/)/, /^@shikijs\//],
            },
        }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
    ],
});

export default config;
