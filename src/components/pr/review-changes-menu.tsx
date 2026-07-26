import { useSelector } from "@tanstack/react-store";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import type { ReviewEvent } from "#/lib/session/types.ts";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

const EVENTS: Array<{ value: ReviewEvent; label: string; hint: string }> = [
    {
        value: "comment",
        label: "Comment",
        hint: "Submit general feedback without explicit approval.",
    },
    {
        value: "approve",
        label: "Approve",
        hint: "Submit feedback and approve merging these changes.",
    },
    {
        value: "request-changes",
        label: "Request changes",
        hint: "Submit feedback that must be addressed before merging.",
    },
];

const SUBMIT_LABEL: Record<ReviewEvent, string> = {
    comment: "Comment",
    approve: "Approve",
    "request-changes": "Request changes",
};

/** GitHub-style “Review changes” control — green trigger with finish-review dropdown. */
export function ReviewChangesMenu({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const draft = useSelector(session.state, () => session.getReviewDraft(repository, number));
    const page = useSelector(session.state, () => session.getPullRequestPage(repository, number));
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busyRef = useRef(false);

    const detail = page.detail;
    const pendingCount = draft.comments.length;
    const blobBase = detail
        ? `https://github.com/${detail.repository}/blob/${detail.headRefName}/`
        : `https://github.com/${repository}/`;

    async function handleSubmit() {
        if (busyRef.current || draft.stale) {
            return;
        }

        busyRef.current = true;
        setSubmitting(true);
        setError(null);

        try {
            await session.submitReview(repository, number);
            setOpen(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not submit the review.");
        } finally {
            busyRef.current = false;
            setSubmitting(false);
        }
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <HelpTooltip
                label={
                    pendingCount > 0
                        ? `Finish your review · ${pendingCount} pending ${pendingCount === 1 ? "comment" : "comments"}`
                        : "Finish your review — comment, approve, or request changes"
                }
            >
                <PopoverTrigger asChild>
                    <Button
                        size="sm"
                        className="bg-[#1f883d] text-white hover:bg-[#1a7f37] focus-visible:ring-[#1f883d]/40 dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                    >
                        Review changes
                        {pendingCount > 0 ? (
                            <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-semibold tabular-nums">
                                {pendingCount}
                            </span>
                        ) : null}
                        <ChevronDown className="size-3.5 opacity-90" aria-hidden="true" />
                    </Button>
                </PopoverTrigger>
            </HelpTooltip>
            <PopoverContent
                align="end"
                className="w-[min(28rem,calc(100vw-2rem))] max-h-[min(36rem,calc(100svh-6rem))] overflow-y-auto p-0"
            >
                <div className="flex flex-col gap-3 p-4">
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

                    <fieldset
                        disabled={draft.stale}
                        className="group/review flex flex-col gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <legend className="text-sm font-medium">Finish your review</legend>
                        <ul className="flex flex-col gap-2">
                            {EVENTS.map((entry) => (
                                <li key={entry.value}>
                                    <label
                                        className={cn(
                                            "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2 transition-colors group-disabled/review:cursor-not-allowed",
                                            draft.event === entry.value
                                                ? "border-[#1f883d]/50 bg-[#dafbe1]/40 dark:border-[#3fb950]/40 dark:bg-[#238636]/15"
                                                : "hover:bg-muted/50",
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="review-event"
                                            className="mt-1"
                                            checked={draft.event === entry.value}
                                            onChange={() =>
                                                void session.setReviewEvent(repository, number, entry.value)
                                            }
                                        />
                                        <span className="flex min-w-0 flex-col gap-0.5">
                                            <span className="text-sm font-medium">{entry.label}</span>
                                            <span className="text-xs text-muted-foreground">{entry.hint}</span>
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </fieldset>

                    <MarkdownComposer
                        value={draft.body}
                        disabled={draft.stale}
                        rows={4}
                        placeholder="Leave a comment"
                        previewBaseUrl={blobBase}
                        onChange={(body) => void session.setReviewBody(repository, number, body)}
                        onSubmitKey={() => void handleSubmit()}
                    />

                    {pendingCount > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-medium text-muted-foreground">
                                Pending comments ({pendingCount})
                            </p>
                            <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto text-xs">
                                {draft.comments.map((comment) => (
                                    <li
                                        key={comment.id}
                                        className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5"
                                    >
                                        <span className="min-w-0">
                                            <span className="font-mono text-muted-foreground">
                                                {comment.path}:{comment.line}
                                            </span>
                                            {comment.body.includes("```suggestion") ? (
                                                <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                                    suggestion
                                                </span>
                                            ) : null}{" "}
                                            <span className="line-clamp-2">{comment.body}</span>
                                        </span>
                                        <button
                                            type="button"
                                            className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                                            onClick={() =>
                                                void session.removePendingComment(repository, number, comment.id)
                                            }
                                        >
                                            Remove
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end">
                        <Button
                            size="sm"
                            disabled={draft.stale || submitting}
                            className="bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                            onClick={() => void handleSubmit()}
                        >
                            {submitting
                                ? "Submitting…"
                                : `${SUBMIT_LABEL[draft.event]}${pendingCount > 0 ? ` · ${pendingCount}` : ""}`}
                        </Button>
                    </div>

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}
