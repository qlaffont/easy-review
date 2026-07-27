import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

import { InboxBoard } from "#/components/inbox/inbox-board.tsx";
import { buildHead } from "#/lib/seo.ts";

export const Route = createFileRoute("/")({
    head: () =>
        buildHead({
            title: "Inbox",
            description: "Your GitHub pull-request inbox for triage, waiting-on-you work, and drafts.",
            path: "/",
        }),
    component: InboxPage,
});

function InboxPage() {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
            <header className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300">
                    <Inbox className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <h1 className="text-lg font-semibold tracking-tight text-balance">Inbox</h1>
                    <p className="text-xs text-muted-foreground">Triage pull requests waiting on you and yours.</p>
                </div>
            </header>
            <InboxBoard />
        </div>
    );
}
