import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";

import type { MentionCandidate } from "#/components/pr/composer-autocomplete.tsx";
import type { DiffSide, PendingLineComment, ReviewThread } from "#/lib/session/types.ts";

import { CommentActionsMenu, quoteMarkdown } from "#/components/pr/comment-actions.tsx";
import { suggestionOriginalFromHunk } from "#/components/pr/diff-hunk-preview.tsx";
import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { Button } from "#/components/ui/button.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function InlineDiffComments({
    side,
    line,
    lineText,
    pending,
    threads,
    viewerLogin,
    viewerAvatarUrl,
    previewBaseUrl,
    repository,
    number,
    mentionUsers,
    disabled,
    canApplySuggestions,
    onRemovePending,
    onReply,
}: {
    side: DiffSide;
    line: number;
    lineText: string;
    pending: Array<PendingLineComment>;
    threads: Array<ReviewThread>;
    viewerLogin: string | null;
    viewerAvatarUrl: string | null;
    previewBaseUrl: string;
    repository: string;
    number: number;
    mentionUsers?: Array<MentionCandidate>;
    disabled?: boolean;
    canApplySuggestions?: boolean;
    onRemovePending: (commentId: string) => Promise<void>;
    onReply: (threadId: string, body: string) => Promise<void>;
}) {
    if (pending.length === 0 && threads.length === 0) {
        return null;
    }

    const label = `Comment on line ${side === "RIGHT" ? "R" : "L"}${line}`;

    return (
        <div className="border-y border-border/70 bg-muted px-3 py-2 font-sans text-sm">
            <div className="flex flex-col gap-2">
                {pending.map((comment) => (
                    <PendingCommentCard
                        key={comment.id}
                        label={label}
                        comment={comment}
                        viewerLogin={viewerLogin}
                        viewerAvatarUrl={viewerAvatarUrl}
                        previewBaseUrl={previewBaseUrl}
                        suggestionOriginal={lineText}
                        suggestionLine={line}
                        disabled={disabled}
                        onRemove={() => onRemovePending(comment.id)}
                    />
                ))}
                {threads.map((thread) => (
                    <ThreadCommentCard
                        key={thread.id}
                        label={label}
                        thread={thread}
                        viewerLogin={viewerLogin}
                        previewBaseUrl={previewBaseUrl}
                        suggestionOriginal={
                            suggestionOriginalFromHunk(thread.diffHunk, thread.startLine, thread.line, thread.side) ??
                            lineText
                        }
                        suggestionStartLine={thread.startLine}
                        suggestionLine={thread.line ?? line}
                        repository={repository}
                        number={number}
                        canApplySuggestions={Boolean(canApplySuggestions) && side === "RIGHT"}
                        mentionUsers={mentionUsers}
                        disabled={disabled}
                        onReply={(body) => onReply(thread.id, body)}
                    />
                ))}
            </div>
        </div>
    );
}

function PendingCommentCard({
    label,
    comment,
    viewerLogin,
    viewerAvatarUrl,
    previewBaseUrl,
    suggestionOriginal,
    suggestionLine,
    disabled,
    onRemove,
}: {
    label: string;
    comment: PendingLineComment;
    viewerLogin: string | null;
    viewerAvatarUrl: string | null;
    previewBaseUrl: string;
    suggestionOriginal: string;
    suggestionLine: number;
    disabled?: boolean;
    onRemove: () => Promise<void>;
}) {
    const [open, setOpen] = useState(true);
    const [removing, setRemoving] = useState(false);
    const author = viewerLogin ?? "you";

    return (
        <article className="overflow-hidden rounded-md border bg-background">
            <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-1.5 border-b px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
                onClick={() => setOpen((value) => !value)}
            >
                {open ? (
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>
                    {label} <span className="text-amber-700 dark:text-amber-300">(pending review)</span>
                </span>
            </button>
            {open ? (
                <div className="px-3 py-2">
                    <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <AvatarTiny login={author} avatarUrl={viewerAvatarUrl} />
                            <span className="truncate text-sm font-semibold">{author}</span>
                            <span className="text-xs text-muted-foreground">just now</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                Pending
                            </span>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="size-7 text-muted-foreground"
                                disabled={disabled || removing}
                                aria-label="Remove pending comment"
                                onClick={() => {
                                    setRemoving(true);
                                    void notifyAction(onRemove, {
                                        loading: "Removing comment…",
                                        success: "Comment removed",
                                        error: "Could not remove the comment.",
                                    }).finally(() => setRemoving(false));
                                }}
                            >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                            </Button>
                        </div>
                    </header>
                    <div className="text-sm">
                        <Markdown
                            source={comment.body}
                            baseUrl={previewBaseUrl}
                            suggestionOriginal={suggestionOriginal}
                            suggestionLine={suggestionLine}
                        />
                    </div>
                </div>
            ) : null}
        </article>
    );
}

function ThreadCommentCard({
    label,
    thread,
    viewerLogin,
    previewBaseUrl,
    suggestionOriginal,
    suggestionStartLine,
    suggestionLine,
    repository,
    number,
    canApplySuggestions,
    mentionUsers,
    disabled,
    onReply,
}: {
    label: string;
    thread: ReviewThread;
    viewerLogin: string | null;
    previewBaseUrl: string;
    suggestionOriginal: string;
    suggestionStartLine: number | null;
    suggestionLine: number;
    repository: string;
    number: number;
    canApplySuggestions: boolean;
    mentionUsers?: Array<MentionCandidate>;
    disabled?: boolean;
    onReply: (body: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(!thread.isResolved);
    const [replyOpen, setReplyOpen] = useState(false);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const root = thread.comments[0];

    if (!root) {
        return null;
    }

    async function sendReply() {
        const body = reply.trim();
        if (!body || disabled || sending) {
            return;
        }
        setSending(true);
        try {
            await notifyAction(() => onReply(body), {
                loading: "Sending reply…",
                success: "Reply posted",
                error: "Could not post the reply.",
            });
            setReply("");
            setReplyOpen(false);
        } finally {
            setSending(false);
        }
    }

    return (
        <article className={cn("overflow-hidden rounded-md border bg-background", thread.isResolved && "opacity-80")}>
            <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-1.5 border-b px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
                onClick={() => setOpen((value) => !value)}
            >
                {open ? (
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>
                    {label}
                    {thread.isResolved ? <span className="ml-1 text-muted-foreground">(resolved)</span> : null}
                </span>
            </button>
            {open ? (
                <div className="flex flex-col gap-3 px-3 py-2">
                    {thread.comments.map((comment) => {
                        const isAuthor = viewerLogin !== null && comment.author === viewerLogin;
                        return (
                            <div key={comment.id}>
                                <header className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <AvatarTiny login={comment.author} avatarUrl={comment.authorAvatarUrl} />
                                        <span className="truncate text-sm font-semibold">{comment.author}</span>
                                        <RelativeTime
                                            iso={comment.createdAt}
                                            className="text-xs text-muted-foreground"
                                        />
                                        {isAuthor ? (
                                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                Author
                                            </span>
                                        ) : null}
                                    </div>
                                    <CommentActionsMenu
                                        url={comment.url}
                                        body={comment.body}
                                        onQuote={
                                            !disabled && comment.body.trim()
                                                ? () => {
                                                      setReply((current) => {
                                                          const quoted = quoteMarkdown(comment.body);
                                                          return current.trim()
                                                              ? `${current.replace(/\s*$/, "")}\n\n${quoted}`
                                                              : quoted;
                                                      });
                                                      setReplyOpen(true);
                                                  }
                                                : undefined
                                        }
                                    />
                                </header>
                                <div className="text-sm">
                                    <Markdown
                                        source={comment.body}
                                        baseUrl={previewBaseUrl}
                                        suggestionOriginal={suggestionOriginal}
                                        suggestionStartLine={suggestionStartLine}
                                        suggestionLine={suggestionLine}
                                        suggestionApply={
                                            thread.path
                                                ? {
                                                      repository,
                                                      number,
                                                      path: thread.path,
                                                      canApply: canApplySuggestions,
                                                  }
                                                : null
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {!thread.isResolved ? (
                        <div className="border-t pt-2">
                            {replyOpen ? (
                                <MarkdownComposer
                                    compact
                                    autoFocus
                                    value={reply}
                                    onChange={setReply}
                                    rows={2}
                                    placeholder="Reply — @mention or / for commands"
                                    disabled={disabled || sending}
                                    previewBaseUrl={previewBaseUrl}
                                    suggestionOriginal={suggestionOriginal}
                                    suggestionLine={suggestionLine}
                                    repository={repository}
                                    mentionUsers={mentionUsers}
                                    pullRequestNumber={number}
                                    onSubmitKey={() => void sendReply()}
                                    footer={
                                        <>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={sending}
                                                onClick={() => {
                                                    setReply("");
                                                    setReplyOpen(false);
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                disabled={disabled || sending || !reply.trim()}
                                                className="bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                                onClick={() => void sendReply()}
                                            >
                                                {sending ? "Replying…" : "Reply"}
                                            </Button>
                                        </>
                                    }
                                />
                            ) : (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    className="flex w-full cursor-pointer items-center rounded-md border bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => setReplyOpen(true)}
                                >
                                    Reply…
                                </button>
                            )}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}

function AvatarTiny({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
    if (avatarUrl) {
        return <img src={avatarUrl} alt="" className="size-6 shrink-0 rounded-full" />;
    }

    return (
        <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase"
        >
            {login.slice(0, 1)}
        </span>
    );
}
