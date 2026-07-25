import { createFileRoute } from "@tanstack/react-router";

import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useSessionState } from "#/lib/session/provider.tsx";

export const Route = createFileRoute("/")({ component: Inbox });

function Inbox() {
    const openRepoPicker = useOpenRepoPicker();
    const selected = useSessionState((state) => state.repos.selected);

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
            <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>

            {selected.length === 0 ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
                    <p className="text-sm text-muted-foreground">
                        Pick the repositories you triage and their pull requests will show up here.
                    </p>
                    <Button onClick={openRepoPicker}>Choose repositories</Button>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Watching {selected.length} {selected.length === 1 ? "repository" : "repositories"}. Pull requests
                    land here next.
                </p>
            )}
        </div>
    );
}
