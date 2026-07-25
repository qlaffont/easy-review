import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Inbox });

function Inbox() {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-10">
            <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
            <p className="text-sm text-muted-foreground">
                Choose the repositories to triage, and your pull requests will show up here.
            </p>
        </div>
    );
}
