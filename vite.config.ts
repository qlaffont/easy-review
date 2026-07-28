import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    ssr: {
        // Mermaid is client-only (dynamic import + React.lazy). Keep it out of the Nitro SSR graph.
        external: ["mermaid"],
    },
    plugins: [
        devtools(),
        nitro({
            rollupConfig: {
                external: [/^@sentry\//, /^mermaid($|\/)/],
            },
        }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
    ],
});

export default config;
