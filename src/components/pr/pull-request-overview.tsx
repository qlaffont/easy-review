import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import {
    ArrowLeft,
    ExternalLink,
    GitMerge,
    GitPullRequest,
    GitPullRequestDraft,
    RefreshCw,
    XCircle,
} from "lucide-react";
import { useEffect } from "react";

import type { PullRequestPage } from "#/lib/session/session.ts";
import type { CheckRun, CheckState, PullRequestDetail, PullRequestSummary } from "#/lib/session/types.ts";

import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { PullRequestControls } from "#/components/pr/pull-request-controls.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatRelativeTime } from "#/lib/format.ts";
import { useSession } from "#/lib/session/provider.tsx";

/** What a row and a full detail agree on, which is all the page header needs. */
type Headline = PullRequestSummary;

export function PullRequestOverview({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const page = useSelector(session.state, () => session.getPullRequestPage(repository, number));

    useEffect(() => {
        void session.loadPullRequest(repository, number);
    }, [session, repository, number]);

    useEffect(() => {
        function revalidateWhenVisible() {
            if (document.visibilityState === "visible") {
                void session.revalidatePullRequest(repository, number);
            }
        }

        document.addEventListener("visibilitychange", revalidateWhenVisible);
        window.addEventListener("focus", revalidateWhenVisible);

        return () => {
            document.removeEventListener("visibilitychange", revalidateWhenVisible);
            window.removeEventListener("focus", revalidateWhenVisible);
        };
    }, [session, repository, number]);

    const headline: Headline | null = page.detail ?? page.summary;

    if (!headline) {
        return <PullRequestFallback page={page} />;
    }

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
            <PullRequestHeader page={page} headline={headline} />

            {page.error ? <p className="text-sm text-destructive">{page.error.message}</p> : null}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
                <div className="flex min-w-0 flex-col gap-5">
                    <Description
                        body={page.detail?.body ?? ""}
                        isLoading={page.detail === null}
                        baseUrl={blobBaseUrl(headline)}
                    />
                    <ChecksPanel detail={page.detail} />
                    {page.detail ? (
                        <PullRequestControls
                            key={`${page.detail.updatedAt}-${page.detail.isDraft}-${page.detail.state}`}
                            detail={page.detail}
                        />
                    ) : null}
                </div>
                <Sidebar headline={headline} detail={page.detail} />
            </div>
        </div>
    );
}

function PullRequestFallback({ page }: { page: PullRequestPage }) {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
            <BackToInbox />
            {page.status === "error" ? (
                <p className="rounded-lg border p-8 text-center text-sm text-destructive">
                    {page.error?.message ?? "This pull request could not be loaded."}
                </p>
            ) : (
                <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                    Loading {page.repository}#{page.number}…
                </p>
            )}
        </div>
    );
}

function BackToInbox() {
    return (
        <Link to="/" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Inbox
        </Link>
    );
}

const STATE_STYLES = {
    draft: { icon: GitPullRequestDraft, label: "Draft", className: "bg-muted text-muted-foreground" },
    open: { icon: GitPullRequest, label: "Open", className: "bg-emerald-600 text-white" },
    merged: { icon: GitMerge, label: "Merged", className: "bg-violet-600 text-white" },
    closed: { icon: XCircle, label: "Closed", className: "bg-red-600 text-white" },
} as const;

function StateBadge({ pullRequest }: { pullRequest: Headline }) {
    const key = pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state;
    const { icon: Icon, label, className } = STATE_STYLES[key];

    return (
        <span
            className={`flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
        >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
        </span>
    );
}

function PullRequestHeader({ page, headline }: { page: PullRequestPage; headline: Headline }) {
    const session = useSession();

    return (
        <header className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <BackToInbox />
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={page.refreshing}
                        onClick={() => void session.refreshPullRequest(page.repository, page.number)}
                    >
                        <RefreshCw className={page.refreshing ? "animate-spin" : undefined} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                        <a href={headline.url} target="_blank" rel="noreferrer">
                            GitHub
                            <ExternalLink />
                        </a>
                    </Button>
                    <Button size="sm" asChild>
                        <Link
                            to="/pr/$owner/$repo/$number/files"
                            params={{
                                owner: page.repository.split("/")[0] ?? "",
                                repo: page.repository.split("/")[1] ?? "",
                                number: String(page.number),
                            }}
                        >
                            Review changes
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <StateBadge pullRequest={headline} />
                <h1 className="min-w-0 text-xl font-semibold tracking-tight">{headline.title}</h1>
            </div>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{headline.author}</span>
                <span>
                    opened {page.repository}#{page.number} {formatRelativeTime(headline.createdAt)}
                </span>
                <span aria-hidden="true">·</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{headline.baseRefName}</code>
                <span aria-hidden="true">←</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{headline.headRefName}</code>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                    {headline.changedFiles} {headline.changedFiles === 1 ? "file" : "files"}{" "}
                    <span className="text-emerald-600 dark:text-emerald-400">+{headline.additions}</span>{" "}
                    <span className="text-red-600 dark:text-red-400">−{headline.deletions}</span>
                </span>
            </p>
        </header>
    );
}

/** Where GitHub itself resolves the relative links someone wrote in a description. */
function blobBaseUrl(pullRequest: Headline): string {
    return `https://github.com/${pullRequest.repository}/blob/${pullRequest.baseRefName}/`;
}

function Description({ body, isLoading, baseUrl }: { body: string; isLoading: boolean; baseUrl: string }) {
    return (
        <section className="rounded-lg border p-4">
            <h2 className="sr-only">Description</h2>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading the description…</p>
            ) : body.trim() ? (
                <Markdown source={body} baseUrl={baseUrl} />
            ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
            )}
        </section>
    );
}

const CHECK_ORDER: Record<CheckState, number> = { failure: 0, pending: 1, none: 2, success: 3 };

function ChecksPanel({ detail }: { detail: PullRequestDetail | null }) {
    if (!detail) {
        return null;
    }

    if (detail.checkRuns.length === 0) {
        return (
            <section className="rounded-lg border p-4">
                <h2 className="text-sm font-medium">Checks</h2>
                <p className="mt-2 text-sm text-muted-foreground">No checks ran on this commit.</p>
            </section>
        );
    }

    // Copy before sorting: `detail.checkRuns` is session state the UI must not reorder in place.
    const runs = [...detail.checkRuns].sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]);

    return (
        <section className="overflow-hidden rounded-lg border">
            <h2 className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                Checks
                <span className="ml-2 text-xs font-normal text-muted-foreground">on {detail.headSha.slice(0, 7)}</span>
            </h2>
            <ul className="flex flex-col">
                {runs.map((run) => (
                    <CheckRunRow key={`${run.name}-${run.url ?? ""}`} run={run} />
                ))}
            </ul>
        </section>
    );
}

function CheckRunRow({ run }: { run: CheckRun }) {
    return (
        <li className="flex items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0">
            <ChecksDot state={run.state} />
            <span className="min-w-0 flex-1 truncate">{run.name}</span>
            {run.url ? (
                <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                    Details
                </a>
            ) : null}
        </li>
    );
}

const REVIEW_STATE_LABELS = {
    approved: "approved",
    "changes-requested": "requested changes",
    commented: "commented",
    dismissed: "dismissed",
    pending: "pending",
} as const;

function Sidebar({ headline, detail }: { headline: Headline; detail: PullRequestDetail | null }) {
    return (
        <aside className="flex flex-col gap-5 text-sm">
            <SidebarBlock title="Reviewers">
                {headline.reviewers.length === 0 && headline.reviewRequests.length === 0 ? (
                    <p className="text-muted-foreground">Nobody yet.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {headline.reviewers.map((reviewer) => (
                            <li key={reviewer.login} className="flex items-center justify-between gap-2">
                                <span className="truncate">{reviewer.login}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {REVIEW_STATE_LABELS[reviewer.state]}
                                </span>
                            </li>
                        ))}
                        {headline.reviewRequests.map((login) => (
                            <li key={login} className="flex items-center justify-between gap-2">
                                <span className="truncate">{login}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">awaiting</span>
                            </li>
                        ))}
                    </ul>
                )}
            </SidebarBlock>

            <SidebarBlock title="Assignees">
                {detail === null ? (
                    <p className="text-muted-foreground">…</p>
                ) : detail.assignees.length === 0 ? (
                    <p className="text-muted-foreground">Nobody assigned.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {detail.assignees.map((login) => (
                            <li key={login} className="truncate">
                                {login}
                            </li>
                        ))}
                    </ul>
                )}
            </SidebarBlock>

            <SidebarBlock title="Labels">
                {detail === null ? (
                    <p className="text-muted-foreground">…</p>
                ) : detail.labels.length === 0 ? (
                    <p className="text-muted-foreground">No labels.</p>
                ) : (
                    <ul className="flex flex-wrap gap-1.5">
                        {detail.labels.map((label) => (
                            <li key={label.name}>
                                <Badge
                                    variant="outline"
                                    className="font-normal"
                                    style={{ borderColor: `#${label.color}` }}
                                >
                                    {label.name}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </SidebarBlock>

            {detail?.mergeable === "conflicting" ? (
                <p className="rounded-md border border-red-600/40 bg-red-600/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    This branch has conflicts with {headline.baseRefName}.
                </p>
            ) : null}
        </aside>
    );
}

function SidebarBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
            {children}
        </section>
    );
}
