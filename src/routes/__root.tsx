import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { AppUpdateWatcher } from "#/components/app-update-watcher.tsx";
import { SessionGate } from "#/components/session-gate.tsx";
import { ThemeProvider } from "#/components/theme-provider.tsx";
import { Toaster } from "#/components/ui/sonner.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";
import { buildHead, siteName } from "#/lib/seo.ts";
import { SessionProvider } from "#/lib/session/provider.tsx";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
    head: () => ({
        meta: [
            {
                charSet: "utf-8",
            },
            {
                name: "viewport",
                content: "width=device-width, initial-scale=1",
            },
            ...buildHead({
                title: siteName(),
                description:
                    "Triage GitHub pull requests, review diffs, and submit staged reviews without leaving Easy Review.",
            }).meta,
        ],
        links: [
            {
                rel: "stylesheet",
                href: appCss,
            },
            // PNG first — Slack (and many crawlers) ignore SVG favicons for unfurls.
            { rel: "icon", href: "/favicon-inbox.png", type: "image/png", sizes: "32x32" },
            { rel: "icon", href: "/favicon-inbox.svg", type: "image/svg+xml" },
            { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
        ],
    }),
    shellComponent: RootDocument,
    component: RootLayout,
});

function RootLayout() {
    return (
        <>
            <SessionGate>
                <Outlet />
            </SessionGate>
            <AppUpdateWatcher />
        </>
    );
}

function RootDocument({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
            </head>
            <body suppressHydrationWarning>
                <ThemeProvider>
                    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
                        <SessionProvider>{children}</SessionProvider>
                        <Toaster />
                    </TooltipProvider>
                </ThemeProvider>
                {import.meta.env.DEV ? (
                    <TanStackDevtools
                        config={{
                            position: "bottom-right",
                        }}
                        plugins={[
                            {
                                name: "Tanstack Router",
                                render: <TanStackRouterDevtoolsPanel />,
                            },
                        ]}
                    />
                ) : null}
                <Scripts />
            </body>
        </html>
    );
}
