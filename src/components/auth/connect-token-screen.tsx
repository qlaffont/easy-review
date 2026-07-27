import { ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { TokenPermissions } from "#/components/auth/token-permissions.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { usePageSeo } from "#/lib/seo.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyError, notifySuccess } from "#/lib/toast.ts";

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

const ERROR_TITLES: Record<string, string> = {
    unauthorized: "GitHub did not accept this token",
    forbidden: "This token is missing a permission",
    "rate-limited": "GitHub rate limit reached",
    network: "Could not reach GitHub",
    "not-found": "GitHub could not find that resource",
    unknown: "Something went wrong",
};

/** `onClose` is only provided when replacing a token that already works. */
export function ConnectTokenScreen({ onClose }: { onClose?: () => void }) {
    const session = useSession();
    const auth = useSessionState((state) => state.auth);
    const [token, setToken] = useState("");
    const isReplacing = onClose !== undefined;

    usePageSeo({
        title: isReplacing ? "Replace token" : "Connect",
        description: isReplacing
            ? "Replace your GitHub personal access token in Easy Review."
            : "Connect a GitHub personal access token to start reviewing pull requests in Easy Review.",
    });

    function handleCancel() {
        session.cancelConnect();
        onClose?.();
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void session.connect(token).then(() => {
            if (session.state.state.auth.status === "authenticated") {
                setToken("");
                notifySuccess("Connected to GitHub");
                onClose?.();
                return;
            }

            const message = session.state.state.auth.error?.message;
            if (message) {
                notifyError(message);
            }
        });
    }

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
            <header className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    {isReplacing ? "Replace your GitHub token" : "Connect Easy Review to GitHub"}
                </h1>
                <p className="text-sm text-muted-foreground">
                    Easy Review talks to GitHub straight from this browser. Your token is stored here and is never sent
                    to an Easy Review server.
                </p>
            </header>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <Label htmlFor="github-token">Fine-grained personal access token</Label>
                <div className="flex gap-2">
                    <Input
                        id="github-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="github_pat_…"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        aria-describedby="github-token-hint"
                        className="font-mono"
                    />
                    <Button type="submit" disabled={auth.status === "verifying"}>
                        {auth.status === "verifying" ? "Checking…" : "Connect"}
                    </Button>
                    {isReplacing ? (
                        <Button type="button" variant="ghost" onClick={handleCancel}>
                            Cancel
                        </Button>
                    ) : null}
                </div>
                <p id="github-token-hint" className="text-sm text-muted-foreground">
                    <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                        Create a token on GitHub
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>{" "}
                    with the permissions below.
                </p>
            </form>

            {auth.error ? (
                <Alert variant="destructive">
                    <AlertTitle>{ERROR_TITLES[auth.error.kind] ?? ERROR_TITLES.unknown}</AlertTitle>
                    <AlertDescription>{auth.error.message}</AlertDescription>
                </Alert>
            ) : null}

            <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Permissions this token needs</h2>
                <TokenPermissions />
            </section>

            <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Where the token lives</AlertTitle>
                <AlertDescription>
                    The token is kept in this browser profile only. Anyone who can use this profile — or any script
                    injected into this page — can read it. Use a short expiry and revoke it on GitHub when you are done.
                </AlertDescription>
            </Alert>
        </div>
    );
}
