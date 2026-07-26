import { useSelector } from "@tanstack/react-store";
import {
    CircleDot,
    GitCommitHorizontal,
    GitMerge,
    GitPullRequestClosed,
    GitPullRequestDraft,
    Pencil,
    RotateCcw,
    Tag,
    UserPlus,
    UserMinus,
    Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { CheckState, PullRequestTimelineItem, ReviewState } from "#/lib/session/types.ts";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
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
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

/** Description-adjacent conversation: full PR timeline + a direct Comment composer. */
export function PullRequestConversation({
    repository,
    number,
    baseUrl,
    canComment,
    canClose,
}: {
    repository: string;
    number: number;
    baseUrl: string;
    canComment: boolean;
    canClose?: boolean;
}) {
    const session = useSession();
    const timeline = useSelector(session.state, () => session.getConversationComments(repository, number));
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hasBody = body.trim().length > 0;
    const busy = posting || closing;

    useEffect(() => {
        void session.loadConversationComments(repository, number);
    }, [session, repository, number]);

    async function post() {
        if (!hasBody || busy) {
            return;
        }

        setPosting(true);
        setError(null);
        try {
            await session.addPullRequestComment(repository, number, body);
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
            if (hasBody) {
                await session.addPullRequestComment(repository, number, body);
                setBody("");
            }
            await session.closePullRequest(repository, number);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not close the pull request.");
        } finally {
            setClosing(false);
        }
    }

    return (
        <section className="flex flex-col gap-3" aria-label="Conversation">
            <h2 className="text-sm font-medium">Conversation</h2>

            {timeline.status === "loading" && timeline.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading timeline…</p>
            ) : null}

            {timeline.error ? <p className="text-sm text-destructive">{timeline.error.message}</p> : null}

            {timeline.items.length > 0 ? (
                <ol className="relative flex flex-col gap-0 border-s border-border ms-3 ps-6">
                    {timeline.items.map((item) => (
                        <li key={item.id} className="relative pb-5 last:pb-0">
                            <TimelineItemRow item={item} baseUrl={baseUrl} />
                        </li>
                    ))}
                </ol>
            ) : timeline.status === "ready" ? (
                <p className="text-sm text-muted-foreground">No timeline activity yet.</p>
            ) : null}

            {canComment ? (
                <div className="flex flex-col gap-2">
                    <MarkdownComposer
                        value={body}
                        onChange={setBody}
                        disabled={busy}
                        rows={4}
                        placeholder="Leave a comment"
                        previewBaseUrl={baseUrl}
                        onSubmitKey={() => void post()}
                        footer={
                            <div className="flex flex-wrap items-center justify-end gap-2">
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

function TimelineItemRow({ item, baseUrl }: { item: PullRequestTimelineItem; baseUrl: string }) {
    if (item.kind === "comment") {
        const isBot = /\[bot\]$/i.test(item.author);
        const displayName = item.author.replace(/\[bot\]$/i, "");

        return (
            <>
                <TimelineDot className="bg-background">
                    <AvatarTiny login={displayName} avatarUrl={item.authorAvatarUrl} />
                </TimelineDot>
                <article className="min-w-0 overflow-hidden rounded-md border bg-background">
                    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                        <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                            {displayName}
                        </a>
                        {isBot ? (
                            <span className="rounded border px-1 py-px text-[10px] font-medium text-muted-foreground">
                                Bot
                            </span>
                        ) : null}
                        <RelativeTime iso={item.createdAt} prefix="commented" className="text-muted-foreground" />
                    </header>
                    <div className="px-3 py-3">
                        <Markdown source={item.body} baseUrl={baseUrl} />
                    </div>
                </article>
            </>
        );
    }

    if (item.kind === "review" && item.body.trim()) {
        return (
            <>
                <TimelineDot className="bg-background">
                    <AvatarTiny login={item.author.login} avatarUrl={item.author.avatarUrl} />
                </TimelineDot>
                <article className="min-w-0 overflow-hidden rounded-md border bg-background">
                    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                        <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                            {item.author.login}
                        </a>
                        <RelativeTime
                            iso={item.createdAt}
                            prefix={reviewVerb(item.state)}
                            className="text-muted-foreground"
                        />
                    </header>
                    <div className="px-3 py-3">
                        <Markdown source={item.body} baseUrl={baseUrl} />
                    </div>
                </article>
            </>
        );
    }

    if (item.kind === "commit") {
        return (
            <>
                <TimelineDot>
                    <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
                </TimelineDot>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <AvatarTiny login={item.author.login} avatarUrl={item.author.avatarUrl} size="sm" />
                    <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 truncate font-medium hover:underline"
                    >
                        {item.messageHeadline}
                    </a>
                    <CheckBadge state={item.checkState} />
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
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
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
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                <AvatarTiny login={event.actor.login} avatarUrl={event.actor.avatarUrl} size="sm" />
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
                "absolute top-0.5 -inset-s-6 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border bg-muted text-muted-foreground",
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
    size?: "sm" | "md";
}) {
    const className = size === "sm" ? "size-4 rounded-full" : "size-5 rounded-full";
    if (avatarUrl) {
        return <img src={avatarUrl} alt="" className={className} />;
    }

    return (
        <span className={cn("inline-flex items-center justify-center bg-muted text-[9px] font-medium", className)}>
            {login.slice(0, 1).toUpperCase()}
        </span>
    );
}

function CheckBadge({ state }: { state: CheckState }) {
    if (state === "none") {
        return null;
    }

    return (
        <span
            className={cn(
                "rounded px-1 py-px text-[10px] font-medium",
                state === "success" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                state === "failure" && "bg-red-500/15 text-red-700 dark:text-red-300",
                state === "pending" && "bg-amber-500/15 text-amber-800 dark:text-amber-200",
            )}
        >
            {state === "success" ? "Passing" : state === "failure" ? "Failing" : "Pending"}
        </span>
    );
}
