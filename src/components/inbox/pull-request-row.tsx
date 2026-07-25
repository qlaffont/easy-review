import { Link } from "@tanstack/react-router";
import { CircleDashed, GitPullRequestDraft, MessageSquare } from "lucide-react";
import { memo } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { formatRelativeTime } from "#/lib/format.ts";

function ReviewProgress({ pullRequest }: { pullRequest: PullRequestSummary }) {
    const approvals = pullRequest.reviewers.filter((reviewer) => reviewer.state === "approved").length;
    const changesRequested = pullRequest.reviewers.some((reviewer) => reviewer.state === "changes-requested");
    const pending = pullRequest.reviewRequests.length;

    if (changesRequested) {
        return <span className="text-red-600 dark:text-red-400">Changes requested</span>;
    }

    if (approvals > 0) {
        return (
            <span className="text-emerald-600 dark:text-emerald-400">
                {approvals} approved{pending > 0 ? ` · ${pending} pending` : ""}
            </span>
        );
    }

    if (pending > 0) {
        return <span>{pending} pending</span>;
    }

    return <span>No reviewers</span>;
}

export const PullRequestRow = memo(function PullRequestRow({ pullRequest }: { pullRequest: PullRequestSummary }) {
    const [owner = "", repo = ""] = pullRequest.repository.split("/");

    return (
        <Link
            to="/pr/$owner/$repo/$number"
            params={{ owner, repo, number: String(pullRequest.number) }}
            className="inbox-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm no-underline last:border-b-0 hover:bg-accent/60"
        >
            <ChecksDot state={pullRequest.checks} />

            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                    {pullRequest.isDraft ? (
                        <GitPullRequestDraft className="size-3.5 shrink-0 text-muted-foreground" aria-label="Draft" />
                    ) : null}
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
                    <span className="flex items-center gap-1" title={`${pullRequest.commentCount} comments`}>
                        <MessageSquare className="size-3" aria-hidden="true" />
                        {pullRequest.commentCount}
                    </span>
                ) : null}
                <span title={`${pullRequest.changedFiles} files changed`} className="hidden sm:inline">
                    <span className="text-emerald-600 dark:text-emerald-400">+{pullRequest.additions}</span>{" "}
                    <span className="text-red-600 dark:text-red-400">−{pullRequest.deletions}</span>
                </span>
                <time dateTime={pullRequest.updatedAt} className="w-14 text-right">
                    {formatRelativeTime(pullRequest.updatedAt)}
                </time>
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
