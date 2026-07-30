import { useState } from "react";

import type { ReviewThread } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useReviewThreadsQuery } from "#/lib/query/pull-request.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function ReviewThreadsPanel({
    repository,
    number,
    path,
}: {
    repository: string;
    number: number;
    path: string | null;
}) {
    const threads = useReviewThreadsQuery(repository, number);

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
                <ThreadCard key={thread.id} repository={repository} number={number} thread={thread} />
            ))}
        </div>
    );
}

function ThreadCard({ repository, number, thread }: { repository: string; number: number; thread: ReviewThread }) {
    const session = useSession();
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const { comments, isResolved } = thread;

    async function send() {
        if (!reply.trim()) {
            return;
        }

        setSending(true);
        try {
            await notifyAction(() => session.replyToReviewThread(repository, number, thread.id, reply), {
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
            <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                <span>
                    {isResolved ? "Resolved" : "Open"} · {comments.length}{" "}
                    {comments.length === 1 ? "comment" : "comments"}
                </span>
                {thread.isOutdated ? (
                    <span className="rounded bg-amber-500/15 px-1 py-px font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                        outdated
                    </span>
                ) : null}
            </p>
            <ul className="flex flex-col">
                {comments.map((comment, index) => (
                    <li key={comment.id} className={cn("py-1.5", index > 0 && "border-t border-border")}>
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
