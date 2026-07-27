import { useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";

export function ReviewThreadsPanel({
    repository,
    number,
    path,
}: {
    repository: string;
    number: number;
    path: string | null;
}) {
    const session = useSession();
    const threads = useSelector(session.state, () => session.getReviewThreads(repository, number));

    useEffect(() => {
        void session.loadReviewThreads(repository, number);
    }, [session, repository, number]);

    const visible = path ? threads.items.filter((thread) => thread.path === path) : threads.items;

    if (threads.status === "loading" && threads.items.length === 0) {
        return <p className="p-3 text-xs text-muted-foreground">Loading conversation…</p>;
    }

    if (visible.length === 0) {
        return null;
    }

    return (
        <div className="flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto border-t bg-muted/20 p-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Threads on this file</h3>
            {visible.map((thread) => (
                <ThreadCard
                    key={thread.id}
                    repository={repository}
                    number={number}
                    threadId={thread.id}
                    comments={thread.comments}
                    isResolved={thread.isResolved}
                />
            ))}
        </div>
    );
}

function ThreadCard({
    repository,
    number,
    threadId,
    comments,
    isResolved,
}: {
    repository: string;
    number: number;
    threadId: string;
    comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
    isResolved: boolean;
}) {
    const session = useSession();
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);

    async function send() {
        if (!reply.trim()) {
            return;
        }

        setSending(true);
        try {
            await notifyAction(() => session.replyToReviewThread(repository, number, threadId, reply), {
                loading: "Sending reply…",
                success: "Reply posted",
                error: "Could not post the reply.",
            });
            setReply("");
        } catch {
            // Toast already reports the failure.
        } finally {
            setSending(false);
        }
    }

    return (
        <article className="rounded-md border bg-background p-2 text-xs">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {isResolved ? "Resolved" : "Open"} · {comments.length} {comments.length === 1 ? "comment" : "comments"}
            </p>
            <ul className="flex flex-col gap-1.5">
                {comments.map((comment) => (
                    <li key={comment.id}>
                        <span className="font-medium">{comment.author}</span>{" "}
                        <RelativeTime iso={comment.createdAt} className="text-muted-foreground" />
                        <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p>
                    </li>
                ))}
            </ul>
            {!isResolved ? (
                <div className="mt-2 flex flex-col gap-1.5">
                    <Textarea
                        rows={2}
                        value={reply}
                        placeholder="Reply…"
                        onChange={(event) => setReply(event.target.value)}
                    />
                    <Button size="sm" variant="outline" disabled={sending || !reply.trim()} onClick={() => void send()}>
                        {sending ? "Sending…" : "Reply"}
                    </Button>
                </div>
            ) : null}
        </article>
    );
}
