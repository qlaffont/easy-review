import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { MergeMethod, ReviewEvent } from "#/lib/session/types.ts";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { approveAndMergeBlockedReason, mergeMethodOptions } from "#/components/pr/merge-requirements.ts";
import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { mentionCandidatesFromPullRequest } from "#/lib/composer-commands.ts";
import { useDiffPreferences } from "#/lib/diff-preferences.ts";
import { usePullRequestPage, useReviewThreadsQuery } from "#/lib/query/pull-request.ts";
import { useReviewDraft } from "#/lib/query/review-draft.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { nextStackPullRequestAfterReview } from "#/lib/session/pull-request-stacks.ts";
import { getStackPreferences } from "#/lib/stack-preferences.ts";
import {
    notifyAction,
    notifyBackgroundActionAfterNavigating,
    notifyBackgroundActionWithInboxPrompt,
    notifySuccess,
} from "#/lib/toast.ts";
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

const APPROVE_AND_MERGE_LABEL: Record<MergeMethod, string> = {
    merge: "Approve and merge",
    squash: "Approve and squash",
    rebase: "Approve and rebase",
};

/** GitHub-style “Review changes” control — green trigger with finish-review dropdown. */
export function ReviewChangesMenu({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const navigate = useNavigate();
    const [preferences] = useDiffPreferences();
    const draft = useReviewDraft(repository, number);
    const page = usePullRequestPage(repository, number);
    const threads = useReviewThreadsQuery(repository, number);
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resolvingAll, setResolvingAll] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mergeMethod, setMergeMethod] = useState<MergeMethod | null>(null);
    const busyRef = useRef(false);

    const detail = page.detail;
    const mentionUsers = useMemo(() => mentionCandidatesFromPullRequest(detail), [detail]);
    const unresolvedThreads = useMemo(() => threads.items.filter((thread) => !thread.isResolved), [threads.items]);
    const unresolvedCount = unresolvedThreads.length;
    const pendingCount = draft.comments.length;
    const mergeOptions = detail ? mergeMethodOptions(detail.allowedMergeMethods, detail.commitCount) : [];
    const activeMergeMethod =
        mergeOptions.find((option) => option.value === mergeMethod)?.value ??
        mergeOptions.find((option) => option.value === detail?.defaultMergeMethod)?.value ??
        mergeOptions[0]?.value ??
        null;
    const mergeBlockedReason = detail ? approveAndMergeBlockedReason(detail) : null;
    const showApproveAndMerge =
        draft.event === "approve" && detail?.state === "open" && !detail.isDraft && activeMergeMethod !== null;
    const blobBase = detail
        ? `https://github.com/${detail.repository}/blob/${detail.headRefName}/`
        : `https://github.com/${repository}/`;

    function handleSubmit() {
        submit(() => session.submitReview(repository, number), {
            loading: "Submitting review…",
            success: "Review submitted",
            error: "Could not submit the review.",
        });
    }

    function handleApproveAndMerge(method: MergeMethod) {
        if (mergeBlockedReason) {
            return;
        }

        submit(
            async () => {
                await session.submitReview(repository, number);
                try {
                    await session.mergePullRequest(repository, number, method, {
                        deleteHeadBranch: preferences.deleteHeadBranchOnMerge,
                    });
                } catch (cause) {
                    const reason = cause instanceof Error && cause.message ? cause.message : "unknown error";
                    throw new Error(`Approved, but could not merge: ${reason}`, { cause });
                }
            },
            {
                loading: "Approving and merging…",
                success: "Pull request approved and merged",
                error: "Could not approve and merge the pull request.",
            },
        );
    }

    function submit(action: () => Promise<void>, messages: { loading: string; success: string; error: string }) {
        if (busyRef.current || draft.stale) {
            return;
        }

        busyRef.current = true;
        setSubmitting(true);
        setError(null);
        setOpen(false);

        const nextInStack = nextStackPullRequestAfterReview(detail, getStackPreferences());
        const leavesPage = nextInStack !== null || preferences.returnToInboxAfterReviewOrMerge;
        const submission = nextInStack
            ? notifyBackgroundActionAfterNavigating(action, messages, () => {
                  const [owner = "", repo = ""] = nextInStack.repository.split("/");
                  void navigate({
                      to: "/pr/$owner/$repo/$number",
                      params: { owner, repo, number: String(nextInStack.number) },
                  });
              })
            : notifyBackgroundActionWithInboxPrompt(action, messages, {
                  returnToInbox: preferences.returnToInboxAfterReviewOrMerge,
                  onGoToInbox: () => {
                      session.invalidateInbox();
                      void navigate({ to: "/" });
                  },
              });
        void submission
            .catch((cause) => {
                if (leavesPage) {
                    return;
                }
                setError(cause instanceof Error ? cause.message : messages.error);
                setOpen(true);
            })
            .finally(() => {
                busyRef.current = false;
                setSubmitting(false);
            });
    }

    async function resolveAllThreads() {
        if (busyRef.current || unresolvedCount === 0) {
            return;
        }

        busyRef.current = true;
        setResolvingAll(true);
        setError(null);
        try {
            await notifyAction(
                async () => {
                    await Promise.all(
                        unresolvedThreads.map((thread) =>
                            session.setReviewThreadResolved(repository, number, thread.id, true),
                        ),
                    );
                },
                {
                    loading: "Resolving threads…",
                    success: unresolvedCount === 1 ? "Thread resolved" : `Resolved ${unresolvedCount} threads`,
                    error: "Could not resolve all threads.",
                },
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not resolve all threads.");
        } finally {
            busyRef.current = false;
            setResolvingAll(false);
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
                className="w-[min(36rem,calc(100vw-2rem))] max-h-[min(36rem,calc(100svh-6rem))] overflow-y-auto p-0"
            >
                <div className="flex flex-col gap-3 p-4">
                    {draft.stale ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                            <p>The pull request head moved. This draft no longer matches the tip.</p>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    void notifyAction(() => session.discardReviewDraft(repository, number), {
                                        loading: "Discarding draft…",
                                        success: "Draft discarded",
                                        error: "Could not discard the draft.",
                                    })
                                }
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
                        <ul className="grid grid-cols-3 gap-2">
                            {EVENTS.map((entry) => (
                                <li key={entry.value} className="min-w-0">
                                    <HelpTooltip label={entry.hint}>
                                        <label
                                            className={cn(
                                                "flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-center whitespace-nowrap transition-colors group-disabled/review:cursor-not-allowed",
                                                draft.event === entry.value
                                                    ? "border-[#1f883d]/50 bg-[#dafbe1]/40 dark:border-[#3fb950]/40 dark:bg-[#238636]/15"
                                                    : "hover:bg-muted/50",
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="review-event"
                                                className="shrink-0"
                                                checked={draft.event === entry.value}
                                                onChange={() =>
                                                    void session.setReviewEvent(repository, number, entry.value)
                                                }
                                            />
                                            <span className="text-sm font-medium leading-none">{entry.label}</span>
                                        </label>
                                    </HelpTooltip>
                                </li>
                            ))}
                        </ul>
                    </fieldset>

                    <MarkdownComposer
                        value={draft.body}
                        disabled={draft.stale}
                        rows={4}
                        placeholder="Leave a comment — @mention or / for commands"
                        previewBaseUrl={blobBase}
                        repository={repository}
                        pullRequestNumber={number}
                        mentionUsers={mentionUsers}
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
                                            onClick={() => {
                                                void session
                                                    .removePendingComment(repository, number, comment.id)
                                                    .then(() => notifySuccess("Pending comment removed"));
                                            }}
                                        >
                                            Remove
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {unresolvedCount > 0 ? (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={draft.stale || submitting || resolvingAll}
                                onClick={() => void resolveAllThreads()}
                            >
                                {resolvingAll ? "Resolving…" : "Resolve all threads"}
                            </Button>
                        ) : null}
                        {showApproveAndMerge ? (
                            <ApproveAndMergeButton
                                method={activeMergeMethod}
                                options={mergeOptions}
                                blockedReason={mergeBlockedReason}
                                disabled={draft.stale || submitting || resolvingAll}
                                onSelectMethod={setMergeMethod}
                                onSubmit={handleApproveAndMerge}
                            />
                        ) : null}
                        <Button
                            size="sm"
                            disabled={draft.stale || submitting || resolvingAll}
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

/** Split button: approve, then merge with the chosen method — mirrors the merge box’s method picker. */
function ApproveAndMergeButton({
    method,
    options,
    blockedReason,
    disabled,
    onSelectMethod,
    onSubmit,
}: {
    method: MergeMethod;
    options: ReturnType<typeof mergeMethodOptions>;
    blockedReason: string | null;
    disabled: boolean;
    onSelectMethod: (method: MergeMethod) => void;
    onSubmit: (method: MergeMethod) => void;
}) {
    const blocked = blockedReason !== null;
    const label = APPROVE_AND_MERGE_LABEL[method];
    const mainButton = (
        <Button
            size="sm"
            variant="outline"
            disabled={disabled || blocked}
            className={cn(options.length > 1 ? "rounded-r-none" : undefined)}
            onClick={() => onSubmit(method)}
        >
            {label}
        </Button>
    );

    return (
        <div className="inline-flex">
            {blocked ? (
                <HelpTooltip label={blockedReason}>
                    <span tabIndex={0} className="inline-flex rounded-l-md">
                        {mainButton}
                    </span>
                </HelpTooltip>
            ) : (
                mainButton
            )}
            {options.length > 1 ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={disabled}>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            className="rounded-l-none border-l-0 px-2"
                            aria-label="Select merge method for approve and merge"
                        >
                            <ChevronDown className="size-3.5" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                        {options.map((option, index) => (
                            <div key={option.value}>
                                {index > 0 ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem
                                    className="items-start gap-2 py-2"
                                    onSelect={() => onSelectMethod(option.value)}
                                >
                                    <Check
                                        className={cn(
                                            "mt-0.5 size-3.5 shrink-0",
                                            method === option.value ? "opacity-100" : "opacity-0",
                                        )}
                                        aria-hidden="true"
                                    />
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                        <span className="font-medium">{option.label}</span>
                                        <span className="text-xs text-muted-foreground">{option.description}</span>
                                    </span>
                                </DropdownMenuItem>
                            </div>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}
