import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import {
    ChevronDown,
    ChevronRight,
    GitBranch,
    GitMerge,
    GitPullRequest,
    GitPullRequestClosed,
    GitPullRequestDraft,
    Layers,
    Link2,
    Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { PullRequestStackState } from "#/lib/session/session.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { LoadingIcon } from "#/components/ui/loading.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import {
    formatStackBranches,
    formatStackGhCheckoutCommands,
    formatStackUrls,
} from "#/lib/session/pull-request-stacks.ts";
import { useStackPreferences } from "#/lib/stack-preferences.ts";
import { notifyCopied } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

function StackStateIcon({ pullRequest }: { pullRequest: PullRequestSummary }) {
    if (pullRequest.state === "merged") {
        return <GitMerge className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />;
    }

    if (pullRequest.state === "closed") {
        return (
            <GitPullRequestClosed className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        );
    }

    if (pullRequest.isDraft) {
        return (
            <GitPullRequestDraft className="size-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        );
    }

    return <GitPullRequest className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
}

function stackStatusLabel(pullRequest: PullRequestSummary): string {
    if (pullRequest.state === "merged") {
        return "Merged";
    }
    if (pullRequest.state === "closed") {
        return "Closed";
    }
    if (pullRequest.isDraft) {
        return "Draft";
    }
    return "Open";
}

async function copyText(label: string, value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    notifyCopied(label);
}

const idleStackState: PullRequestStackState = { status: "idle", stack: null, error: null };

function usePullRequestStackState(repository: string, number: number): PullRequestStackState {
    const session = useSession();
    const [stackPreferences] = useStackPreferences();
    const indexState = useSelector(session.state, (storeState) => storeState.repoStackIndices[repository]);
    const overrideState = useSelector(
        session.state,
        (storeState) => storeState.pullRequestStackOverrides[`${repository}#${number}`],
    );

    useEffect(() => {
        if (!stackPreferences.enabled) {
            return;
        }
        void session.loadRepoStackIndex(repository);
    }, [session, repository, stackPreferences.enabled]);

    const stackState = useSelector(session.state, () => {
        if (!stackPreferences.enabled) {
            return idleStackState;
        }

        return session.getPullRequestStack(repository, number);
    });

    useEffect(() => {
        if (!stackPreferences.enabled || stackState.stack) {
            return;
        }

        const indexStatus = indexState?.status ?? "idle";
        const overrideStatus = overrideState?.status ?? "idle";
        if (indexStatus === "idle" || indexStatus === "loading") {
            return;
        }
        if (overrideStatus === "loading" || overrideStatus === "ready") {
            return;
        }

        void session.loadGraphiteStack(repository, number);
    }, [
        session,
        repository,
        number,
        stackPreferences.enabled,
        stackState.stack,
        indexState?.status,
        overrideState?.status,
    ]);

    return stackState;
}

/** Same-repo stack from branch names, with Graphite comment fallback when branches no longer chain. */
export function PullRequestStackPanel({ repository, number }: { repository: string; number: number }) {
    const stackPreferences = useStackPreferences()[0];
    const stackState = usePullRequestStackState(repository, number);
    const [expanded, setExpanded] = useState(true);

    if (!stackPreferences.enabled) {
        return null;
    }

    if (stackState.status === "loading") {
        return <StackPanelLoading />;
    }

    if (!stackState.stack) {
        return null;
    }

    const stack = stackState.stack;
    const [owner = "", repo = ""] = repository.split("/");

    return (
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
            <div className={cn("flex justify-between gap-3", expanded ? "items-start" : "items-center")}>
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    className={cn(
                        "flex min-w-0 flex-1 cursor-pointer gap-2 text-left",
                        expanded ? "items-start" : "items-center",
                    )}
                >
                    <ChevronRight
                        aria-hidden="true"
                        className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-90",
                        )}
                    />
                    {expanded ? (
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                Stack
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                                    {stack.position} of {stack.total}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Pull requests stacked on each other in {repository}.
                            </p>
                        </div>
                    ) : (
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            Stack
                            <span className="text-xs font-normal text-muted-foreground tabular-nums">
                                {stack.position} of {stack.total}
                            </span>
                        </div>
                    )}
                </button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5">
                            Copy stack
                            <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => void copyText("stack URLs", formatStackUrls(stack))}>
                            <Link2 aria-hidden="true" />
                            Copy PR URLs
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void copyText("branch names", formatStackBranches(stack))}>
                            <GitBranch aria-hidden="true" />
                            Copy branch names
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() =>
                                void copyText("`gh` checkout commands", formatStackGhCheckoutCommands(stack))
                            }
                        >
                            <Terminal aria-hidden="true" />
                            Copy `gh pr checkout`
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {expanded ? (
                <ol className="relative m-0 flex list-none flex-col gap-0 p-0">
                    {[...stack.pullRequests].reverse().map((pullRequest, index, reversed) => {
                        const isCurrent = pullRequest.number === number;
                        const isLast = index === reversed.length - 1;

                        return (
                            <li key={pullRequest.key} className="relative flex gap-3 pb-3 last:pb-0">
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        "absolute top-4 bottom-0 left-1.75 w-px bg-border",
                                        isLast && "hidden",
                                    )}
                                />
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        "relative z-10 mt-3 size-3.5 shrink-0 rounded-full border-2 bg-background",
                                        isCurrent ? "border-primary" : "border-muted-foreground/40",
                                    )}
                                />
                                <div className="min-w-0 flex-1">
                                    {isCurrent ? (
                                        <div
                                            className={cn(
                                                "rounded-lg border px-3 py-2",
                                                "border-primary/30 bg-primary/5",
                                            )}
                                        >
                                            <StackRowContent pullRequest={pullRequest} />
                                        </div>
                                    ) : (
                                        <Link
                                            to="/pr/$owner/$repo/$number"
                                            params={{ owner, repo, number: String(pullRequest.number) }}
                                            className="block rounded-lg border px-3 py-2 no-underline transition-colors hover:bg-muted/60"
                                        >
                                            <StackRowContent pullRequest={pullRequest} />
                                        </Link>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            ) : null}
        </section>
    );
}

function StackPanelLoading() {
    return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoadingIcon className="size-4" label="Loading stack" />
            Loading stack…
        </p>
    );
}

function StackRowContent({ pullRequest }: { pullRequest: PullRequestSummary }) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
                <StackStateIcon pullRequest={pullRequest} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{pullRequest.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{pullRequest.number}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{stackStatusLabel(pullRequest)}</span>
                <span aria-hidden="true">·</span>
                <RelativeTime iso={pullRequest.updatedAt} createdAt={pullRequest.createdAt} />
            </span>
        </div>
    );
}
