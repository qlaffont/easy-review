import { createFileRoute } from "@tanstack/react-router";

import { InboxBoard } from "#/components/inbox/inbox-board.tsx";

export const Route = createFileRoute("/")({ component: Inbox });

function Inbox() {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
            <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
            <InboxBoard />
        </div>
    );
}
