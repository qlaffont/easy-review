import { Link } from "@tanstack/react-router";
import {
    ChevronDown,
    ChevronRight,
    CircleDot,
    GitCommitHorizontal,
    GitMerge,
    GitPullRequestClosed,
    GitPullRequestDraft,
    MessageSquare,
    Pencil,
    RotateCcw,
    Tag,
    UserPlus,
    UserMinus,
    Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { PullRequestTimelineItem, ReviewState, ReviewThread } from "#/lib/session/types.ts";

import { CommentActionsMenu, quoteMarkdown } from "#/components/pr/comment-actions.tsx";
import { CommitChecksMenu } from "#/components/pr/commit-checks-menu.tsx";
import { CommitVerifiedBadge } from "#/components/pr/commit-verified-badge.tsx";
import { DiffHunkPreview, suggestionOriginalFromHunk } from "#/components/pr/diff-hunk-preview.tsx";
import { EditableCommentBody } from "#/components/pr/editable-comment-body.tsx";
import { EditedMeta } from "#/components/pr/edited-meta.tsx";
import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { useMarkdownTaskToggle } from "#/components/pr/use-markdown-task-toggle.ts";
import { ReactionBar, ReviewThreadCommentReactions } from "#/components/pr/reaction-bar.tsx";
import { ReviewThreadStatusLabels } from "#/components/pr/review-thread-status.tsx";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { ConversationLoadingSkeleton } from "#/components/ui/loading.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { mentionCandidatesFromPullRequest } from "#/lib/composer-commands.ts";
import { useConversationQuery, usePullRequestPage, useReviewThreadsQuery } from "#/lib/query/pull-request.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

type ConversationEntry =
    | { kind: "timeline"; id: string; at: string; item: PullRequestTimelineItem }
    | { kind: "thread"; id: string; at: string; thread: ReviewThread };

/** Description-adjacent conversation: full PR timeline + a direct Comment composer. */
export function PullRequestConversation({
    repository,
    number,
    baseUrl,
    canComment,
    canClose,
    quoteInsert,
    onQuoteApplied,
    onQuote,
}: {
    repository: string;
    number: number;
    baseUrl: string;
    canComment: boolean;
    canClose?: boolean;
    quoteInsert?: string | null;
    onQuoteApplied?: () => void;
    onQuote?: (body: string) => void;
}) {
    const session = useSession();
    const timeline = useConversationQuery(repository, number);
    const threads = useReviewThreadsQuery(repository, number);
    const page = usePullRequestPage(repository, number);
    const mentionUsers = useMemo(() => mentionCandidatesFromPullRequest(page.detail), [page.detail]);
    const authorLogin = page.detail?.author ?? page.summary?.author ?? null;
    const [owner = "", repo = ""] = repository.split("/");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hasBody = body.trim().length > 0;
    const unresolvedThreads = useMemo(() => threads.items.filter((thread) => !thread.isResolved), [threads.items]);
    const [resolvingAll, setResolvingAll] = useState(false);
    const busy = posting || closing || resolvingAll;
    const loading =
        (timeline.status === "loading" && timeline.items.length === 0) ||
        (threads.status === "loading" && threads.items.length === 0 && timeline.items.length === 0);

    const entries = useMemo((): Array<ConversationEntry> => {
        const timelineEntries: Array<ConversationEntry> = timeline.items.map((item) => ({
            kind: "timeline",
            id: item.id,
            at: item.createdAt,
            item,
        }));
        const threadEntries: Array<ConversationEntry> = threads.items.flatMap((thread) => {
            const at = thread.comments[0]?.createdAt;
            if (!at) {
                return [];
            }
            return [{ kind: "thread" as const, id: thread.id, at, thread }];
        });
        return [...timelineEntries, ...threadEntries].sort((a, b) => a.at.localeCompare(b.at));
    }, [timeline.items, threads.items]);

    useEffect(() => {
        if (!quoteInsert) {
            return;
        }
        setBody((current) => (current ? `${current.replace(/\s*$/, "")}\n\n${quoteInsert}` : quoteInsert));
        onQuoteApplied?.();
    }, [quoteInsert, onQuoteApplied]);

    async function post() {
        if (!hasBody || busy) {
            return;
        }

        setPosting(true);
        setError(null);
        try {
            await notifyAction(() => session.addPullRequestComment(repository, number, body), {
                loading: "Posting comment…",
                success: "Comment posted",
                error: "Could not post the comment.",
            });
            setBody("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not post the comment.");
        } finally {
            setPosting(false);
        }
    }

    async function closePullRequest() {
        if (busy || !canClose) {
            return;
        }

        setClosing(true);
        setError(null);
        try {
            await notifyAction(
                async () => {
                    if (hasBody) {
                        await session.addPullRequestComment(repository, number, body);
                        setBody("");
                    }
                    await session.closePullRequest(repository, number);
                },
                {
                    loading: hasBody ? "Closing with comment…" : "Closing pull request…",
                    success: "Pull request closed",
                    error: "Could not close the pull request.",
                },
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not close the pull request.");
        } finally {
            setClosing(false);
        }
    }

    async function resolveAllThreads() {
        if (busy || unresolvedThreads.length === 0) {
            return;
        }

        setResolvingAll(true);
        setError(null);
        const count = unresolvedThreads.length;
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
                    success: count === 1 ? "Thread resolved" : `Resolved ${count} threads`,
                    error: "Could not resolve all threads.",
                },
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not resolve all threads.");
        } finally {
            setResolvingAll(false);
        }
    }

    return (
        <section className="flex flex-col gap-3" aria-label="Conversation">
            <h2 className="text-sm font-medium">Conversation</h2>

            {loading ? <ConversationLoadingSkeleton /> : null}

            {timeline.error ? <p className="text-sm text-destructive">{timeline.error.message}</p> : null}
            {threads.error ? <p className="text-sm text-destructive">{threads.error.message}</p> : null}

            {entries.length > 0 ? (
                <ol className="flex flex-col">
                    {entries.map((entry) => (
                        <li key={entry.id} className="group/timeline relative flex items-start gap-3 pb-5 last:pb-0">
                            <span
                                aria-hidden="true"
                                className="absolute inset-s-3 top-6 bottom-0 w-px bg-border group-last/timeline:hidden"
                            />
                            {entry.kind === "timeline" ? (
                                <TimelineItemRow
                                    item={entry.item}
                                    baseUrl={baseUrl}
                                    repository={repository}
                                    number={number}
                                    onQuote={onQuote}
                                />
                            ) : (
                                <TimelineReviewThread
                                    thread={entry.thread}
                                    baseUrl={baseUrl}
                                    repository={repository}
                                    number={number}
                                    owner={owner}
                                    repo={repo}
                                    authorLogin={authorLogin}
                                    mentionUsers={mentionUsers}
                                    canReply={canComment}
                                    canApplySuggestions={page.detail?.state === "open"}
                                />
                            )}
                        </li>
                    ))}
                </ol>
            ) : timeline.status === "ready" && threads.status === "ready" ? (
                <p className="text-sm text-muted-foreground">No timeline activity yet.</p>
            ) : null}

            {canComment ? (
                <div className="flex flex-col gap-2">
                    <MarkdownComposer
                        value={body}
                        onChange={setBody}
                        disabled={busy}
                        rows={4}
                        placeholder="Leave a comment — @mention or / for commands"
                        previewBaseUrl={baseUrl}
                        repository={repository}
                        pullRequestNumber={number}
                        mentionUsers={mentionUsers}
                        onSubmitKey={() => void post()}
                        footer={
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {unresolvedThreads.length > 0 ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        className="h-7"
                                        onClick={() => void resolveAllThreads()}
                                    >
                                        {resolvingAll ? "Resolving…" : "Resolve all threads"}
                                    </Button>
                                ) : null}
                                {canClose ? (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1.5">
                                                <GitPullRequestClosed
                                                    className="size-3.5 text-[#cf222e]"
                                                    aria-hidden="true"
                                                />
                                                {hasBody ? "Close with comment" : "Close pull request"}
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    {hasBody ? "Close with comment?" : "Close pull request?"}
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    {hasBody
                                                        ? "Your comment will be posted and the pull request will be closed. The branch is not deleted."
                                                        : "The pull request will stay on GitHub as closed. This does not delete the branch."}
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    className="bg-[#cf222e] text-white hover:bg-[#a40e26]"
                                                    onClick={() => void closePullRequest()}
                                                >
                                                    {hasBody ? "Close with comment" : "Close pull request"}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                ) : null}
                                <Button
                                    size="sm"
                                    disabled={busy || !hasBody}
                                    className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                    onClick={() => void post()}
                                >
                                    {posting ? "Commenting…" : "Comment"}
                                </Button>
                            </div>
                        }
                    />
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
            ) : null}
        </section>
    );
}

function TimelineReviewThread({
    thread,
    baseUrl,
    repository,
    number,
    owner,
    repo,
    authorLogin,
    mentionUsers,
    canReply,
    canApplySuggestions,
}: {
    thread: ReviewThread;
    baseUrl: string;
    repository: string;
    number: number;
    owner: string;
    repo: string;
    authorLogin: string | null;
    mentionUsers: ReturnType<typeof mentionCandidatesFromPullRequest>;
    canReply: boolean;
    canApplySuggestions: boolean;
}) {
    const session = useSession();
    const root = thread.comments[0];
    const [open, setOpen] = useState(!thread.isResolved);
    const [replyOpen, setReplyOpen] = useState(false);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [resolving, setResolving] = useState(false);

    if (!root) {
        return null;
    }

    async function sendReply() {
        const body = reply.trim();
        if (!body || sending) {
            return;
        }
        setSending(true);
        try {
            await notifyAction(() => session.replyToReviewThread(repository, number, thread.id, body), {
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

    async function replyAndResolve() {
        const body = reply.trim();
        if (!body || sending || resolving || thread.isResolved) {
            return;
        }
        setSending(true);
        setResolving(true);
        try {
            await notifyAction(
                async () => {
                    await session.replyToReviewThread(repository, number, thread.id, body);
                    await session.setReviewThreadResolved(repository, number, thread.id, true);
                },
                {
                    loading: "Replying and resolving…",
                    success: "Reply posted · conversation resolved",
                    error: "Could not reply and resolve.",
                },
            );
            setReply("");
            setReplyOpen(false);
            setOpen(false);
        } finally {
            setSending(false);
            setResolving(false);
        }
    }

    async function toggleResolved() {
        if (resolving) {
            return;
        }
        const next = !thread.isResolved;
        setResolving(true);
        try {
            await notifyAction(
                () => session.setReviewThreadResolved(repository, number, thread.id, next),
                next
                    ? {
                          loading: "Resolving conversation…",
                          success: "Conversation resolved",
                          error: "Could not resolve the conversation.",
                      }
                    : {
                          loading: "Unresolving conversation…",
                          success: "Conversation reopened",
                          error: "Could not unresolve the conversation.",
                      },
            );
            setOpen(!next);
            if (next) {
                setReplyOpen(false);
            }
        } finally {
            setResolving(false);
        }
    }

    return (
        <>
            <TimelineDot className="mt-2 bg-background">
                <MessageSquare className="size-3.5" aria-hidden="true" />
            </TimelineDot>
            <article
                className={cn(
                    "min-w-0 flex-1 overflow-hidden rounded-md border bg-background",
                    (thread.isResolved || thread.isOutdated) && "opacity-90",
                )}
            >
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                    <AvatarTiny login={root.author} avatarUrl={root.authorAvatarUrl} />
                    <span className="font-semibold text-foreground">{root.author}</span>
                    <RelativeTime iso={root.createdAt} prefix="commented" className="text-muted-foreground" />
                    <Link
                        to="/pr/$owner/$repo/$number"
                        params={{ owner, repo, number: String(number) }}
                        search={{ path: thread.path }}
                        hash="review"
                        className="ms-auto text-muted-foreground hover:text-foreground hover:underline"
                    >
                        View reviewed changes
                    </Link>
                </header>

                <div className="border-b">
                    <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
                        onClick={() => setOpen((value) => !value)}
                    >
                        {open ? (
                            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0 truncate font-mono">{thread.path}</span>
                        {thread.line != null ? <span className="shrink-0 tabular-nums">:{thread.line}</span> : null}
                        <ReviewThreadStatusLabels thread={thread} className="ms-1" />
                    </button>
                </div>

                {open ? (
                    <>
                        {thread.diffHunk ? (
                            <DiffHunkPreview hunk={thread.diffHunk} focusLine={thread.line} side={thread.side} />
                        ) : null}
                        <div className="px-3 pb-3">
                            {thread.comments.map((comment, index) => (
                                <div
                                    key={comment.id}
                                    className={cn("min-w-0 py-3", index > 0 && "border-t border-border")}
                                >
                                    <header className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                                        <AvatarTiny login={comment.author} avatarUrl={comment.authorAvatarUrl} />
                                        <span className="font-semibold text-foreground">{comment.author}</span>
                                        {authorLogin && comment.author === authorLogin ? (
                                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                Author
                                            </span>
                                        ) : null}
                                        <RelativeTime iso={comment.createdAt} className="text-muted-foreground" />
                                        <div className="ml-auto">
                                            <CommentActionsMenu
                                                url={comment.url}
                                                body={comment.body}
                                                onQuote={
                                                    canReply && comment.body.trim()
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
                                        </div>
                                    </header>
                                    <Markdown
                                        source={comment.body}
                                        baseUrl={baseUrl}
                                        suggestionOriginal={suggestionOriginalFromHunk(
                                            thread.diffHunk,
                                            thread.startLine,
                                            thread.line,
                                            thread.side,
                                        )}
                                        suggestionStartLine={thread.startLine}
                                        suggestionLine={thread.line}
                                        suggestionApply={
                                            thread.path && thread.line != null && thread.side !== "LEFT"
                                                ? {
                                                      repository,
                                                      number,
                                                      path: thread.path,
                                                      canApply: canApplySuggestions,
                                                  }
                                                : null
                                        }
                                    />
                                    <div className="mt-2">
                                        <ReviewThreadCommentReactions
                                            repository={repository}
                                            number={number}
                                            comment={comment}
                                        />
                                    </div>
                                </div>
                            ))}

                            {canReply ? (
                                <div className="border-t pt-2">
                                    {replyOpen ? (
                                        <MarkdownComposer
                                            compact
                                            autoFocus
                                            value={reply}
                                            onChange={setReply}
                                            rows={2}
                                            placeholder="Reply — @mention or / for commands"
                                            disabled={sending}
                                            previewBaseUrl={baseUrl}
                                            repository={repository}
                                            pullRequestNumber={number}
                                            mentionUsers={mentionUsers}
                                            onSubmitKey={() => void sendReply()}
                                            footer={
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={sending || resolving}
                                                        onClick={() => {
                                                            setReply("");
                                                            setReplyOpen(false);
                                                        }}
                                                    >
                                                        Cancel
                                                    </Button>
                                                    {thread.isResolved ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={resolving}
                                                            onClick={() => void toggleResolved()}
                                                        >
                                                            Unresolve
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            disabled={sending || resolving || !reply.trim()}
                                                            className="bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                                            onClick={() => void replyAndResolve()}
                                                        >
                                                            {sending || resolving ? "Working…" : "Reply and resolve"}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        disabled={sending || resolving || !reply.trim()}
                                                        className="bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                                        onClick={() => void sendReply()}
                                                    >
                                                        {sending ? "Replying…" : "Reply"}
                                                    </Button>
                                                </>
                                            }
                                        />
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 cursor-pointer items-center rounded-md border bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                                onClick={() => setReplyOpen(true)}
                                            >
                                                Reply…
                                            </button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={resolving}
                                                onClick={() => void toggleResolved()}
                                            >
                                                {thread.isResolved ? "Unresolve" : "Resolve"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="border-t pt-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={resolving}
                                        onClick={() => void toggleResolved()}
                                    >
                                        {thread.isResolved ? "Unresolve conversation" : "Resolve conversation"}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </>
                ) : null}
            </article>
        </>
    );
}

function IssueTimelineComment({
    item,
    baseUrl,
    repository,
    number,
    onQuote,
}: {
    item: Extract<PullRequestTimelineItem, { kind: "comment" }>;
    baseUrl: string;
    repository: string;
    number: number;
    onQuote?: (body: string) => void;
}) {
    const session = useSession();
    const viewerLogin = useSessionState((state) => state.auth.viewer?.login);
    const [editing, setEditing] = useState(false);
    const isBot = /\[bot\]$/i.test(item.author);
    const displayName = item.author.replace(/\[bot\]$/i, "");
    const canEdit = Boolean(viewerLogin && viewerLogin === item.author);

    return (
        <>
            <TimelineDot className="mt-2 bg-background">
                <MessageSquare className="size-3.5" aria-hidden="true" />
            </TimelineDot>
            <article className="min-w-0 flex-1 overflow-hidden rounded-md border bg-background">
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                    <AvatarTiny login={displayName} avatarUrl={item.authorAvatarUrl} />
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        {displayName}
                    </a>
                    {isBot ? (
                        <span className="rounded border px-1 py-px text-[10px] font-medium text-muted-foreground">
                            Bot
                        </span>
                    ) : null}
                    <RelativeTime iso={item.createdAt} prefix="commented" className="text-muted-foreground" />
                    <EditedMeta
                        lastEditedAt={item.lastEditedAt}
                        editor={item.editor}
                        editCount={item.editCount}
                        edits={item.edits}
                        createdAt={item.createdAt}
                        authorLogin={item.author}
                        authorAvatarUrl={item.authorAvatarUrl}
                    />
                    <div className="ml-auto">
                        <CommentActionsMenu
                            url={item.url}
                            body={item.body}
                            canEdit={canEdit}
                            onEdit={canEdit ? () => setEditing(true) : undefined}
                            onQuote={item.body.trim() && onQuote ? () => onQuote(item.body) : undefined}
                        />
                    </div>
                </header>
                <div className="px-3 py-3">
                    <EditableCommentBody
                        body={item.body}
                        baseUrl={baseUrl}
                        repository={repository}
                        number={number}
                        canEdit={canEdit}
                        editing={editing}
                        onEditingChange={setEditing}
                        onSave={(body) => session.updateIssueComment(repository, number, item.databaseId, body)}
                    />
                </div>
                <div className="border-t px-3 py-2">
                    <ReactionBar
                        groups={item.reactionGroups}
                        onToggle={(content) => {
                            void notifyAction(
                                () => session.toggleIssueCommentReaction(repository, number, item.databaseId, content),
                                {
                                    loading: "Updating reaction…",
                                    success: "Reaction updated",
                                    error: "Could not update the reaction.",
                                },
                            );
                        }}
                    />
                </div>
            </article>
        </>
    );
}

function ReviewTimelineComment({
    item,
    baseUrl,
    repository,
    number,
    onQuote,
}: {
    item: Extract<PullRequestTimelineItem, { kind: "review" }>;
    baseUrl: string;
    repository: string;
    number: number;
    onQuote?: (body: string) => void;
}) {
    const session = useSession();
    const { source, onToggleTask } = useMarkdownTaskToggle(item.body, (body) =>
        session.updatePullRequestReview(repository, number, item.id, body),
    );

    return (
        <>
            <TimelineDot className="mt-2 bg-background">
                <MessageSquare className="size-3.5" aria-hidden="true" />
            </TimelineDot>
            <article className="min-w-0 flex-1 overflow-hidden rounded-md border bg-background">
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                    <AvatarTiny login={item.author.login} avatarUrl={item.author.avatarUrl} />
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        {item.author.login}
                    </a>
                    <RelativeTime
                        iso={item.createdAt}
                        prefix={reviewVerb(item.state)}
                        className="text-muted-foreground"
                    />
                    <div className="ml-auto">
                        <CommentActionsMenu
                            url={item.url}
                            body={item.body}
                            onQuote={item.body.trim() && onQuote ? () => onQuote(item.body) : undefined}
                        />
                    </div>
                </header>
                <div className="px-3 py-3">
                    <Markdown source={source} baseUrl={baseUrl} onToggleTask={onToggleTask} />
                </div>
            </article>
        </>
    );
}

function TimelineItemRow({
    item,
    baseUrl,
    repository,
    number,
    onQuote,
}: {
    item: PullRequestTimelineItem;
    baseUrl: string;
    repository: string;
    number: number;
    onQuote?: (body: string) => void;
}) {
    if (item.kind === "comment") {
        return (
            <IssueTimelineComment
                item={item}
                baseUrl={baseUrl}
                repository={repository}
                number={number}
                onQuote={onQuote}
            />
        );
    }

    if (item.kind === "review" && item.body.trim()) {
        return (
            <ReviewTimelineComment
                item={item}
                baseUrl={baseUrl}
                repository={repository}
                number={number}
                onQuote={onQuote}
            />
        );
    }

    if (item.kind === "commit") {
        return (
            <>
                <TimelineDot>
                    <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
                </TimelineDot>
                <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <AvatarTiny login={item.author.login} avatarUrl={item.author.avatarUrl} size="sm" />
                    <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 truncate font-medium hover:underline"
                    >
                        {item.messageHeadline}
                    </a>
                    {item.signature?.verified ? (
                        <CommitVerifiedBadge signature={item.signature} verifiedAt={item.createdAt} />
                    ) : null}
                    <CommitChecksMenu state={item.checkState} runs={item.checkRuns} />
                    <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-muted-foreground hover:underline"
                    >
                        {item.abbreviatedOid}
                    </a>
                </div>
            </>
        );
    }

    if (item.kind === "renamed-title") {
        return (
            <>
                <TimelineDot>
                    <Pencil className="size-3.5" aria-hidden="true" />
                </TimelineDot>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    <p className="flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                        <AvatarTiny login={item.actor.login} avatarUrl={item.actor.avatarUrl} size="sm" />
                        <span className="font-medium text-foreground">{item.actor.login}</span>
                        <span>changed the title</span>
                        <RelativeTime iso={item.createdAt} />
                    </p>
                    <p className="text-muted-foreground line-through">{item.previousTitle}</p>
                    <p className="font-medium text-foreground">{item.currentTitle}</p>
                </div>
            </>
        );
    }

    const event = describeEvent(item);
    if (!event) {
        return null;
    }

    return (
        <>
            <TimelineDot>{event.icon}</TimelineDot>
            <p className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                <AvatarTiny login={event.actor.login} avatarUrl={event.actor.avatarUrl} />
                <span className="font-medium text-foreground">{event.actor.login}</span>
                <span>{event.text}</span>
                <RelativeTime iso={item.createdAt} />
            </p>
        </>
    );
}

function describeEvent(
    item: PullRequestTimelineItem,
): { actor: { login: string; avatarUrl: string | null }; text: string; icon: ReactNode } | null {
    switch (item.kind) {
        case "assigned":
            return {
                actor: item.actor,
                text: item.actor.login === item.assignee ? "self-assigned this" : `assigned ${item.assignee}`,
                icon: <UserPlus className="size-3.5" aria-hidden="true" />,
            };
        case "unassigned":
            return {
                actor: item.actor,
                text: `unassigned ${item.assignee}`,
                icon: <UserMinus className="size-3.5" aria-hidden="true" />,
            };
        case "labeled":
            return {
                actor: item.actor,
                text: `added the ${item.label.name} label`,
                icon: <Tag className="size-3.5" aria-hidden="true" />,
            };
        case "unlabeled":
            return {
                actor: item.actor,
                text: `removed the ${item.label.name} label`,
                icon: <Tag className="size-3.5" aria-hidden="true" />,
            };
        case "review-requested":
            return {
                actor: item.actor,
                text: `requested a review from ${item.reviewer}`,
                icon: <Users className="size-3.5" aria-hidden="true" />,
            };
        case "review-request-removed":
            return {
                actor: item.actor,
                text: `removed ${item.reviewer}'s review request`,
                icon: <Users className="size-3.5" aria-hidden="true" />,
            };
        case "ready-for-review":
            return {
                actor: item.actor,
                text: "marked this pull request as ready for review",
                icon: <CircleDot className="size-3.5" aria-hidden="true" />,
            };
        case "convert-to-draft":
            return {
                actor: item.actor,
                text: "converted this pull request to draft",
                icon: <GitPullRequestDraft className="size-3.5" aria-hidden="true" />,
            };
        case "closed":
            return {
                actor: item.actor,
                text: "closed this",
                icon: <GitPullRequestClosed className="size-3.5" aria-hidden="true" />,
            };
        case "reopened":
            return {
                actor: item.actor,
                text: "reopened this",
                icon: <RotateCcw className="size-3.5" aria-hidden="true" />,
            };
        case "merged":
            return {
                actor: item.actor,
                text: "merged this pull request",
                icon: <GitMerge className="size-3.5" aria-hidden="true" />,
            };
        case "review":
            return {
                actor: item.author,
                text: reviewVerb(item.state),
                icon: <CircleDot className="size-3.5" aria-hidden="true" />,
            };
        case "head-ref-force-pushed":
            return {
                actor: item.actor,
                text: "force-pushed the branch",
                icon: <GitCommitHorizontal className="size-3.5" aria-hidden="true" />,
            };
        case "base-ref-changed":
            return {
                actor: item.actor,
                text: `changed the base branch from ${item.previousRefName} to ${item.currentRefName}`,
                icon: <GitCommitHorizontal className="size-3.5" aria-hidden="true" />,
            };
        default:
            return null;
    }
}

function reviewVerb(state: ReviewState): string {
    switch (state) {
        case "approved":
            return "approved these changes";
        case "changes-requested":
            return "requested changes";
        case "dismissed":
            return "dismissed a review";
        case "pending":
            return "started a review";
        default:
            return "reviewed";
    }
}

function TimelineDot({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span
            className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground",
                className,
            )}
        >
            {children}
        </span>
    );
}

function AvatarTiny({
    login,
    avatarUrl,
    size = "md",
}: {
    login: string;
    avatarUrl: string | null;
    size?: "sm" | "md" | "lg";
}) {
    const className =
        size === "sm" ? "size-4 rounded-full" : size === "lg" ? "size-6 rounded-full" : "size-5 rounded-full";
    const resolved =
        avatarUrl ?? (/^[\w-]+$/.test(login) && login !== "ghost" ? `https://github.com/${login}.png?size=40` : null);

    if (resolved) {
        return <img src={resolved} alt="" className={className} />;
    }

    return (
        <span className={cn("inline-flex items-center justify-center bg-muted text-[9px] font-medium", className)}>
            {login.slice(0, 1).toUpperCase()}
        </span>
    );
}
