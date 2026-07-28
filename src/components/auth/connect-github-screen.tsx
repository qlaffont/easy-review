import { Building2, ExternalLink, Github, ShieldCheck } from "lucide-react";
import { useEffect } from "react";

import { ThemeMenuButton } from "#/components/theme-menu.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { GITHUB_APP_PERMISSION_DEFS } from "#/lib/github/oauth-scopes.ts";
import { usePageSeo } from "#/lib/seo.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyError } from "#/lib/toast.ts";

const ERROR_TITLES: Record<string, string> = {
    unauthorized: "GitHub sign-in failed",
    forbidden: "This session is missing a permission",
    "rate-limited": "GitHub rate limit reached",
    network: "Could not reach GitHub",
    "not-found": "GitHub could not find that resource",
    unknown: "Something went wrong",
};

/** `onClose` is only provided when reconnecting while already signed in. */
export function ConnectGithubScreen({ onClose }: { onClose?: () => void }) {
    const session = useSession();
    const auth = useSessionState((state) => state.auth);
    const isReplacing = onClose !== undefined;

    usePageSeo({
        title: isReplacing ? "Reconnect" : "Connect",
        description: isReplacing
            ? "Reconnect your GitHub account to Easy Review."
            : "Sign in with GitHub to start reviewing pull requests in Easy Review.",
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const authError = params.get("authError");
        if (!authError) {
            return;
        }

        session.reportAuthError(authError);
        notifyError(authError);
        params.delete("authError");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState(null, "", next);
    }, [session]);

    function handleCancel() {
        session.cancelConnect();
        onClose?.();
    }

    return (
        <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
            <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
                <ThemeMenuButton />
            </div>
            <header className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <img src="/favicon-inbox.svg" alt="" width={40} height={40} className="size-10 shrink-0" />
                    <span className="text-lg font-semibold tracking-tight">Easy Review</span>
                </div>
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {isReplacing ? "Reconnect GitHub" : "Connect Easy Review to GitHub"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Install the GitHub App on your account and organizations first, then sign in. The server holds
                        the client secret; your access token stays in an HTTP-only cookie.
                    </p>
                </div>
            </header>

            <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={auth.status === "verifying"} onClick={() => session.beginOAuthLogin()}>
                    <Github aria-hidden="true" />
                    {auth.status === "verifying" ? "Redirecting…" : "Sign in with GitHub"}
                </Button>
                <Button type="button" variant="outline" asChild>
                    <a href="/api/auth/github/install">
                        <ExternalLink aria-hidden="true" />
                        Install GitHub App
                    </a>
                </Button>
                {isReplacing ? (
                    <Button type="button" variant="ghost" onClick={handleCancel}>
                        Cancel
                    </Button>
                ) : null}
            </div>

            <Alert>
                <Building2 aria-hidden="true" />
                <AlertTitle>Organization repositories</AlertTitle>
                <AlertDescription>
                    <p>
                        Use <strong>Install GitHub App</strong> and choose each organization (and the repositories). The
                        app must allow install on <strong>Any account</strong>. After installing, sign in again and
                        refresh the repo list.
                    </p>
                </AlertDescription>
            </Alert>

            {auth.error ? (
                <Alert variant="destructive">
                    <AlertTitle>{ERROR_TITLES[auth.error.kind] ?? ERROR_TITLES.unknown}</AlertTitle>
                    <AlertDescription>{auth.error.message}</AlertDescription>
                </Alert>
            ) : null}

            <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">GitHub App permissions this product needs</h2>
                <dl className="divide-y divide-border overflow-hidden rounded-lg border text-sm">
                    {GITHUB_APP_PERMISSION_DEFS.map((permission) => (
                        <div key={permission.name} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
                            <dt className="font-medium text-xs sm:text-sm">
                                {permission.name}
                                <span className="mt-0.5 block font-normal text-muted-foreground">
                                    {permission.access}
                                </span>
                            </dt>
                            <dd className="text-muted-foreground">{permission.why}</dd>
                        </div>
                    ))}
                </dl>
                <p className="text-sm text-muted-foreground">
                    Set these under the app’s Permissions &amp; events, then reinstall / reconnect. Guide:{" "}
                    <code className="text-xs">docs/github-setup.md</code>.
                </p>
            </section>

            <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Where credentials live</AlertTitle>
                <AlertDescription>
                    The client secret never leaves the Easy Review server. Your user access token is stored in an
                    HTTP-only cookie and is attached by the server when proxying requests to GitHub.
                </AlertDescription>
            </Alert>
        </div>
    );
}
