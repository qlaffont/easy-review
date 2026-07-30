import { Link } from "@tanstack/react-router";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { useState } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card } from "#/components/ui/card.tsx";
import { useRelatedPullRequestsQuery } from "#/lib/query/pull-request.ts";
import { RELATED_SIDEBAR_VISIBLE_CAP } from "#/lib/session/related-pull-requests.ts";

function RelatedStateIcon({ pullRequest }: { pullRequest: PullRequestSummary }) {
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

function RelatedRow({ pullRequest }: { pullRequest: PullRequestSummary }) {
    const [owner = "", repo = ""] = pullRequest.repository.split("/");

    return (
        <Card className="gap-0 py-0 shadow-none">
            <Link
                to="/pr/$owner/$repo/$number"
                params={{ owner, repo, number: String(pullRequest.number) }}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-col gap-0.5 rounded-xl px-2.5 py-2 no-underline transition-colors hover:bg-muted/60"
            >
                <span className="truncate text-xs text-muted-foreground">{pullRequest.repository}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                    <RelatedStateIcon pullRequest={pullRequest} />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{pullRequest.title}</span>
                </span>
            </Link>
        </Card>
    );
}

/** Cross-repo PRs that share this PR's head → base branch names. */
export function RelatedPullRequestsSidebar({
    repository,
    number,
    headRefName: _headRefName,
    baseRefName: _baseRefName,
}: {
    repository: string;
    number: number;
    headRefName: string;
    baseRefName: string;
}) {
    const related = useRelatedPullRequestsQuery(repository, number);
    const [expanded, setExpanded] = useState(false);

    const hasItems = related.items.length > 0;
    const visible = expanded ? related.items : related.items.slice(0, RELATED_SIDEBAR_VISIBLE_CAP);
    const hiddenCount = related.items.length - visible.length;

    if (!hasItems && related.status === "loading") {
        return null;
    }

    if (!hasItems && related.status === "ready") {
        return null;
    }

    if (!hasItems) {
        return related.error ? <p className="pb-3 text-xs text-destructive">{related.error.message}</p> : null;
    }

    return (
        <section className="flex flex-col gap-2 border-b pb-3">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium text-muted-foreground">Related</h2>
                <Badge variant="secondary">{related.items.length}</Badge>
            </div>

            <ul className="flex flex-col gap-2">
                {visible.map((pullRequest) => (
                    <li key={pullRequest.key}>
                        <RelatedRow pullRequest={pullRequest} />
                    </li>
                ))}
            </ul>

            {hiddenCount > 0 ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 justify-start px-0.5 text-xs text-muted-foreground"
                    onClick={() => setExpanded(true)}
                >
                    Show {hiddenCount} more
                </Button>
            ) : null}

            {related.error ? <p className="text-xs text-destructive">{related.error.message}</p> : null}
        </section>
    );
}
