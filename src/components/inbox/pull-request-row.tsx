import { Link } from "@tanstack/react-router";
import {
    AlertTriangle,
    CircleDashed,
    GitMerge,
    GitPullRequest,
    GitPullRequestClosed,
    GitPullRequestDraft,
    MessageSquare,
} from "lucide-react";
import { memo } from "react";

import type { PullRequestSummary, ReviewState } from "#/lib/session/types.ts";

import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { PullRequestStackBadge } from "#/components/pr/pull-request-stack-panel.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { cn } from "#/lib/utils.ts";

const REVIEW_STATUS_LABEL: Record<ReviewState, string> = {
    approved: "Approved",
    "changes-requested": "Changes requested",
    commented: "Commented",
    dismissed: "Dismissed",
    pending: "Review requested",
};

const REVIEW_STATUS_RING: Record<ReviewState, string> = {
    approved: "ring-[#1a7f37] dark:ring-[#3fb950]",
    "changes-requested": "ring-[#cf222e] dark:ring-[#f85149]",
    commented: "ring-slate-400 dark:ring-slate-500",
    dismissed: "ring-slate-300 dark:ring-slate-600",
    pending: "ring-amber-500 dark:ring-amber-400",
};

const REVIEW_STATUS_ORDER: Record<ReviewState, number> = {
    "changes-requested": 0,
    approved: 1,
    pending: 2,
    commented: 3,
    dismissed: 4,
};

const MAX_VISIBLE_REVIEWERS = 5;

type ReviewerChip = {
    login: string;
    state: ReviewState;
};

function collectReviewers(pullRequest: PullRequestSummary): Array<ReviewerChip> {
    const byLogin = new Map<string, ReviewerChip>();

    for (const reviewer of pullRequest.reviewers) {
        byLogin.set(reviewer.login, { login: reviewer.login, state: reviewer.state });
    }

    for (const login of pullRequest.reviewRequests) {
        if (!byLogin.has(login)) {
            byLogin.set(login, { login, state: "pending" });
        }
    }

    return [...byLogin.values()].sort(
        (a, b) => REVIEW_STATUS_ORDER[a.state] - REVIEW_STATUS_ORDER[b.state] || a.login.localeCompare(b.login),
    );
}

function reviewerAvatarUrl(login: string): string | null {
    // Teams are requested by name and are not GitHub user logins.
    if (!/^[\w-]+$/.test(login) || login.includes(" ")) {
        return null;
    }
    return `https://github.com/${login}.png?size=40`;
}

function AuthorAvatar({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
    const src = avatarUrl ?? reviewerAvatarUrl(login);

    if (src) {
        return <img src={src} alt="" className="size-3.5 shrink-0 rounded-full" />;
    }

    return (
        <span
            aria-hidden="true"
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold uppercase"
        >
            {login.slice(0, 1)}
        </span>
    );
}

function ReviewerAvatars({ pullRequest }: { pullRequest: PullRequestSummary }) {
    const reviewers = collectReviewers(pullRequest);

    if (reviewers.length === 0) {
        return <span className="text-muted-foreground">No reviewers</span>;
    }

    const visible = reviewers.slice(0, MAX_VISIBLE_REVIEWERS);
    const overflow = reviewers.length - visible.length;

    return (
        <span className="inline-flex items-center" aria-label={`${reviewers.length} reviewers`}>
            {visible.map((reviewer, index) => {
                const src = reviewerAvatarUrl(reviewer.login);
                const label = `${reviewer.login} · ${REVIEW_STATUS_LABEL[reviewer.state]}`;

                return (
                    <HelpTooltip key={`${reviewer.login}-${reviewer.state}`} label={label}>
                        <span
                            className={cn(
                                "relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[9px] font-semibold uppercase text-muted-foreground ring-2 ring-offset-1 ring-offset-background",
                                REVIEW_STATUS_RING[reviewer.state],
                                index > 0 && "-ml-1.5",
                            )}
                            style={{ zIndex: visible.length - index }}
                            aria-label={label}
                        >
                            {src ? (
                                <img src={src} alt="" className="size-full object-cover" />
                            ) : (
                                reviewer.login.slice(0, 1)
                            )}
                        </span>
                    </HelpTooltip>
                );
            })}
            {overflow > 0 ? (
                <HelpTooltip
                    label={reviewers
                        .slice(MAX_VISIBLE_REVIEWERS)
                        .map((reviewer) => `${reviewer.login} · ${REVIEW_STATUS_LABEL[reviewer.state]}`)
                        .join(", ")}
                >
                    <span className="relative -ml-1.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-muted-foreground/30 ring-offset-1 ring-offset-background">
                        +{overflow}
                    </span>
                </HelpTooltip>
            ) : null}
        </span>
    );
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

export { PullRequestStateIcon };

export const PullRequestRow = memo(function PullRequestRow({
    pullRequest,
    selected = false,
}: {
    pullRequest: PullRequestSummary;
    selected?: boolean;
}) {
    const [owner = "", repo = ""] = pullRequest.repository.split("/");
    const hasConflicts = pullRequest.state === "open" && pullRequest.mergeable === "conflicting";

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
                    <PullRequestStackBadge repository={pullRequest.repository} number={pullRequest.number} />
                    {hasConflicts ? (
                        <HelpTooltip label="This branch has conflicts that must be resolved">
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                Conflicts
                            </span>
                        </HelpTooltip>
                    ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                        {pullRequest.repository}#{pullRequest.number}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                        <AuthorAvatar login={pullRequest.author} avatarUrl={pullRequest.authorAvatarUrl} />
                        <span className="truncate">{pullRequest.author}</span>
                    </span>
                </span>
            </span>

            <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <ReviewerAvatars pullRequest={pullRequest} />
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
                <RelativeTime
                    iso={pullRequest.updatedAt}
                    createdAt={pullRequest.createdAt}
                    className="w-14 text-right"
                />
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
