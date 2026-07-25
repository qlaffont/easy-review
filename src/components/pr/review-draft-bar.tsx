import { useSelector } from "@tanstack/react-store";
import { useState } from "react";

import type { ReviewEvent } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useSession } from "#/lib/session/provider.tsx";

const EVENTS: Array<{ value: ReviewEvent; label: string }> = [
    { value: "comment", label: "Comment" },
    { value: "approve", label: "Approve" },
    { value: "request-changes", label: "Request changes" },
];

export function ReviewDraftBar({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const draft = useSelector(session.state, () => session.getReviewDraft(repository, number));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        setSubmitting(true);
        setError(null);

        try {
            await session.submitReview(repository, number);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not submit the review.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 py-3">
            {draft.stale ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                    <p>The pull request head moved. This draft no longer matches the tip.</p>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void session.discardReviewDraft(repository, number)}
                    >
                        Discard draft
                    </Button>
                </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Review type
                    <select
                        className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                        value={draft.event}
                        disabled={draft.stale}
                        onChange={(event) =>
                            void session.setReviewEvent(repository, number, event.target.value as ReviewEvent)
                        }
                    >
                        {EVENTS.map((entry) => (
                            <option key={entry.value} value={entry.value}>
                                {entry.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                    Summary
                    <Textarea
                        value={draft.body}
                        disabled={draft.stale}
                        rows={2}
                        placeholder="Optional summary for the review"
                        onChange={(event) => void session.setReviewBody(repository, number, event.target.value)}
                    />
                </label>

                <Button disabled={draft.stale || submitting} onClick={() => void handleSubmit()} className="sm:mb-0.5">
                    {submitting
                        ? "Submitting…"
                        : `Submit${draft.comments.length > 0 ? ` (${draft.comments.length})` : ""}`}
                </Button>
            </div>

            {draft.comments.length > 0 ? (
                <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto text-xs">
                    {draft.comments.map((comment) => (
                        <li
                            key={comment.id}
                            className="flex items-start justify-between gap-2 rounded border px-2 py-1"
                        >
                            <span className="min-w-0">
                                <span className="font-mono text-muted-foreground">
                                    {comment.path}:{comment.line}
                                </span>{" "}
                                {comment.body}
                            </span>
                            <button
                                type="button"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => void session.removePendingComment(repository, number, comment.id)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
    );
}
