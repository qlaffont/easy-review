import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
    resolve: { tsconfigPaths: true },
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
