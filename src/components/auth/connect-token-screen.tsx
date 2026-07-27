import { ExternalLink, Github, ShieldCheck } from "lucide-react";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { GITHUB_OAUTH_SCOPE_DEFS } from "#/lib/github/oauth-scopes.ts";
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
export function ConnectTokenScreen({ onClose }: { onClose?: () => void }) {
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
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
            <header className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    {isReplacing ? "Reconnect GitHub" : "Connect Easy Review to GitHub"}
                </h1>
                <p className="text-sm text-muted-foreground">
                    Sign in with a GitHub OAuth app. Easy Review’s server holds the client secret and proxies API calls;
                    your access token stays in an HTTP-only cookie.
                </p>
            </header>

            <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={auth.status === "verifying"} onClick={() => session.beginOAuthLogin()}>
                    <Github aria-hidden="true" />
                    {auth.status === "verifying" ? "Redirecting…" : "Sign in with GitHub"}
                </Button>
                {isReplacing ? (
                    <Button type="button" variant="ghost" onClick={handleCancel}>
                        Cancel
                    </Button>
                ) : null}
            </div>

            {auth.error ? (
                <Alert variant="destructive">
                    <AlertTitle>{ERROR_TITLES[auth.error.kind] ?? ERROR_TITLES.unknown}</AlertTitle>
                    <AlertDescription>{auth.error.message}</AlertDescription>
                </Alert>
            ) : null}

            <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">OAuth scopes this app requests</h2>
                <dl className="divide-y divide-border overflow-hidden rounded-lg border text-sm">
                    {GITHUB_OAUTH_SCOPE_DEFS.map((scope) => (
                        <div key={scope.name} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
                            <dt className="font-medium font-mono text-xs sm:text-sm">{scope.name}</dt>
                            <dd className="text-muted-foreground">{scope.why}</dd>
                        </div>
                    ))}
                </dl>
                <p className="text-sm text-muted-foreground">
                    <a
                        href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1"
                    >
                        GitHub OAuth scope reference
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                </p>
            </section>

            <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Where credentials live</AlertTitle>
                <AlertDescription>
                    The OAuth client secret never leaves the Easy Review server. Your user access token is stored in an
                    HTTP-only cookie and is attached by the server when proxying requests to GitHub.
                </AlertDescription>
            </Alert>
        </div>
    );
}
