import { Link } from "@tanstack/react-router";
import {
    CircleDashed,
    GitMerge,
    GitPullRequest,
    GitPullRequestClosed,
    GitPullRequestDraft,
    MessageSquare,
} from "lucide-react";
import { memo } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { cn } from "#/lib/utils.ts";

function ReviewProgress({ pullRequest }: { pullRequest: PullRequestSummary }) {
    const approvals = pullRequest.reviewers.filter((reviewer) => reviewer.state === "approved").length;
    const changesRequested = pullRequest.reviewers.some((reviewer) => reviewer.state === "changes-requested");
    const pending = pullRequest.reviewRequests.length;

    if (changesRequested) {
        return <span className="text-rose-600 dark:text-rose-400">Changes requested</span>;
    }

    if (approvals > 0) {
        return (
            <span className="text-emerald-600 dark:text-emerald-400">
                {approvals} approved{pending > 0 ? ` · ${pending} pending` : ""}
            </span>
        );
    }

    if (pending > 0) {
        return <span className="text-sky-700 dark:text-sky-300">{pending} pending</span>;
    }

    return <span>No reviewers</span>;
}

function PullRequestStateIcon({ pullRequest }: { pullRequest: PullRequestSummary }) {
    if (pullRequest.state === "merged") {
        return <GitMerge className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-label="Merged" />;
    }

    if (pullRequest.state === "closed") {
        return (
            <GitPullRequestClosed className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-label="Closed" />
        );
    }

    if (pullRequest.isDraft) {
        return (
            <GitPullRequestDraft className="size-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-label="Draft" />
        );
    }

    return <GitPullRequest className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Open" />;
}

export const PullRequestRow = memo(function PullRequestRow({
    pullRequest,
    selected = false,
}: {
    pullRequest: PullRequestSummary;
    selected?: boolean;
}) {
    const [owner = "", repo = ""] = pullRequest.repository.split("/");

    return (
        <Link
            to="/pr/$owner/$repo/$number"
            params={{ owner, repo, number: String(pullRequest.number) }}
            data-selected={selected || undefined}
            aria-current={selected ? "true" : undefined}
            className={cn(
                "inbox-row grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm no-underline last:border-b-0 hover:bg-accent/60",
                selected && "bg-accent",
            )}
        >
            <ChecksDot state={pullRequest.checks} />

            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                    <PullRequestStateIcon pullRequest={pullRequest} />
                    <span className="truncate font-medium text-foreground">{pullRequest.title}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                        {pullRequest.repository}#{pullRequest.number}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{pullRequest.author}</span>
                    <span aria-hidden="true">·</span>
                    <ReviewProgress pullRequest={pullRequest} />
                </span>
            </span>

            <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                {pullRequest.commentCount > 0 ? (
                    <HelpTooltip label={`${pullRequest.commentCount} comments`}>
                        <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" aria-hidden="true" />
                            {pullRequest.commentCount}
                        </span>
                    </HelpTooltip>
                ) : null}
                <HelpTooltip label={`${pullRequest.changedFiles} files changed`}>
                    <span className="hidden sm:inline">
                        <span className="text-emerald-600 dark:text-emerald-400">+{pullRequest.additions}</span>{" "}
                        <span className="text-red-600 dark:text-red-400">−{pullRequest.deletions}</span>
                    </span>
                </HelpTooltip>
                <RelativeTime iso={pullRequest.updatedAt} className="w-14 text-right" />
            </span>
        </Link>
    );
});

export const emptySectionRow = (
    <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
        <CircleDashed className="size-3.5" aria-hidden="true" />
        Nothing here.
    </p>
);
