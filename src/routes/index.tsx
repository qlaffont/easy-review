import { createFileRoute } from "@tanstack/react-router";

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
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10">
            <InboxBoard />
        </div>
    );
}
