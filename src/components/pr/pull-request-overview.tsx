import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import {
    ArrowLeft,
    Copy,
    ExternalLink,
    GitMerge,
    GitPullRequest,
    GitPullRequestDraft,
    RefreshCw,
    XCircle,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";

import type { PullRequestPage } from "#/lib/session/session.ts";
import type { CheckRun, CheckState, PullRequestDetail, PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { PullRequestConversation } from "#/components/pr/conversation.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { PullRequestControls } from "#/components/pr/pull-request-controls.tsx";
import { ReviewChangesMenu } from "#/components/pr/review-changes-menu.tsx";
import { ReviewChanges } from "#/components/pr/review-changes.tsx";
import { PullRequestSidebarMetadata } from "#/components/pr/sidebar-metadata.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

/** What a row and a full detail agree on, which is all the page header needs. */
type Headline = PullRequestSummary;

function scrollToReview() {
    document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function PullRequestOverview({
    repository,
    number,
    initialPath,
}: {
    repository: string;
    number: number;
    initialPath?: string;
}) {
    const session = useSession();
    const page = useSelector(session.state, () => session.getPullRequestPage(repository, number));
    const headline: Headline | null = page.detail ?? page.summary;
    const headerSentinelRef = useRef<HTMLDivElement>(null);
    const [stickyVisible, setStickyVisible] = useState(false);
    useSetActionTarget(headline ? targetFromSummary(headline) : null);

    useEffect(() => {
        void session.loadPullRequest(repository, number);
        void session.loadPullRequestFiles(repository, number);
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

    useEffect(() => {
        if (window.location.hash === "#review" || initialPath) {
            requestAnimationFrame(() => scrollToReview());
        }
    }, [initialPath, headline?.key]);

    useEffect(() => {
        const node = headerSentinelRef.current;
        if (!node) {
            return;
        }

        // App header is h-12 — treat the page header as gone once it clears that band.
        const observer = new IntersectionObserver(
            ([entry]) => {
                setStickyVisible(!(entry?.isIntersecting ?? true));
            },
            { rootMargin: "-48px 0px 0px 0px", threshold: 0 },
        );
        observer.observe(node);

        return () => observer.disconnect();
    }, [headline?.key]);

    if (!headline) {
        return <PullRequestFallback page={page} />;
    }

    return (
        <>
            <StickyPullRequestBar headline={headline} visible={stickyVisible} />
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
                <div ref={headerSentinelRef}>
                    <PullRequestHeader page={page} headline={headline} />
                </div>

                {page.error ? <p className="text-sm text-destructive">{page.error.message}</p> : null}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="flex min-w-0 flex-col gap-5">
                        <Description
                            body={page.detail?.body ?? ""}
                            isLoading={page.detail === null}
                            baseUrl={blobBaseUrl(headline)}
                        />
                        <PullRequestConversation
                            repository={repository}
                            number={number}
                            baseUrl={blobBaseUrl(headline)}
                            canComment
                            canClose={page.detail?.state === "open"}
                        />
                        {page.detail ? (
                            <PullRequestControls
                                key={`${page.detail.updatedAt}-${page.detail.isDraft}-${page.detail.state}`}
                                detail={page.detail}
                            />
                        ) : null}
                    </div>
                    <Sidebar headline={headline} detail={page.detail} />
                </div>

                <ReviewChanges repository={repository} number={number} initialPath={initialPath} />
            </div>
        </>
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
        <Link
            to="/"
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
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

function StateBadge({ pullRequest, compact }: { pullRequest: Headline; compact?: boolean }) {
    const key = pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state;
    const { icon: Icon, label, className } = STATE_STYLES[key];

    return (
        <span
            className={cn(
                "flex w-fit shrink-0 items-center gap-1.5 rounded-full font-medium",
                compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
                className,
            )}
        >
            <Icon className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
            {label}
        </span>
    );
}

/** Compact chrome that sticks under the app header once the page title scrolls away. */
function StickyPullRequestBar({ headline, visible }: { headline: Headline; visible: boolean }) {
    return (
        <div
            aria-hidden={!visible}
            inert={!visible ? true : undefined}
            className={cn(
                "fixed inset-x-0 top-12 z-20 border-b bg-background/95 shadow-sm backdrop-blur transition duration-200",
                visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
            )}
        >
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
                <StateBadge pullRequest={headline} compact />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <p className="truncate text-sm font-semibold tracking-tight">{headline.title}</p>
                        <span className="shrink-0 text-sm text-muted-foreground">#{headline.number}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0">by {headline.author}</span>
                        <code className="max-w-[min(28rem,40vw)] truncate rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-800 dark:text-sky-200">
                            {headline.headRefName}
                        </code>
                        <HelpTooltip label="Copy branch name">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-6 shrink-0"
                                onClick={() => void navigator.clipboard.writeText(headline.headRefName)}
                            >
                                <Copy className="size-3" aria-hidden="true" />
                                <span className="sr-only">Copy branch name</span>
                            </Button>
                        </HelpTooltip>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <HelpTooltip label="Open on GitHub">
                        <Button variant="ghost" size="icon-sm" className="size-8" asChild>
                            <a href={headline.url} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-3.5" aria-hidden="true" />
                                <span className="sr-only">Open on GitHub</span>
                            </a>
                        </Button>
                    </HelpTooltip>
                    <ReviewChangesMenu repository={headline.repository} number={headline.number} />
                </div>
            </div>
        </div>
    );
}

function PullRequestHeader({ page, headline }: { page: PullRequestPage; headline: Headline }) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const busyRef = useRef(false);
    const isOpen = (page.detail?.state ?? headline.state) === "open";
    const isDraft = page.detail?.isDraft ?? headline.isDraft;

    async function run(action: () => Promise<void>) {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setActionError(null);
        try {
            await action();
        } catch (cause) {
            setActionError(cause instanceof Error ? cause.message : "That action failed.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return (
        <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <BackToInbox />
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {isOpen ? (
                        <HelpTooltip
                            label={
                                isDraft
                                    ? "Mark this pull request ready for review"
                                    : "Convert this pull request back to a draft"
                            }
                        >
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy || page.refreshing}
                                onClick={() =>
                                    void run(async () => {
                                        await session.setPullRequestDraft(page.repository, page.number, !isDraft);
                                    })
                                }
                            >
                                {isDraft ? "Ready for review" : "Convert to draft"}
                            </Button>
                        </HelpTooltip>
                    ) : null}
                    <HelpTooltip label="Reload this pull request from GitHub">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={page.refreshing || busy}
                            onClick={() => void session.refreshPullRequest(page.repository, page.number)}
                        >
                            <RefreshCw className={page.refreshing ? "animate-spin" : undefined} />
                            Refresh
                        </Button>
                    </HelpTooltip>
                    <HelpTooltip label="Open on GitHub">
                        <Button variant="outline" size="sm" asChild>
                            <a href={headline.url} target="_blank" rel="noreferrer">
                                GitHub
                                <ExternalLink />
                            </a>
                        </Button>
                    </HelpTooltip>
                    <ReviewChangesMenu repository={page.repository} number={page.number} />
                </div>
            </div>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

            <div className="flex flex-wrap items-center gap-3">
                <StateBadge pullRequest={headline} />
                <h1 className="min-w-0 text-xl font-semibold tracking-tight">{headline.title}</h1>
            </div>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{headline.author}</span>
                <span className="inline-flex flex-wrap items-center gap-x-1">
                    opened {page.repository}#{page.number} <RelativeTime iso={headline.createdAt} />
                </span>
                <span aria-hidden="true">·</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{headline.baseRefName}</code>
                <span aria-hidden="true">←</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{headline.headRefName}</code>
                <span aria-hidden="true">·</span>
                <button
                    type="button"
                    onClick={scrollToReview}
                    className="cursor-pointer tabular-nums underline-offset-2 hover:text-foreground hover:underline"
                >
                    {headline.changedFiles} {headline.changedFiles === 1 ? "file" : "files"}{" "}
                    <span className="text-emerald-600 dark:text-emerald-400">+{headline.additions}</span>{" "}
                    <span className="text-red-600 dark:text-red-400">−{headline.deletions}</span>
                </button>
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
        return (
            <SidebarBlock title="Checks">
                <p className="text-muted-foreground">…</p>
            </SidebarBlock>
        );
    }

    if (detail.checkRuns.length === 0) {
        return (
            <SidebarBlock title="Checks">
                <p className="text-muted-foreground">No checks on {detail.headSha.slice(0, 7)}.</p>
            </SidebarBlock>
        );
    }

    // Copy before sorting: `detail.checkRuns` is session state the UI must not reorder in place.
    const runs = [...detail.checkRuns].sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]);

    return (
        <SidebarBlock title={`Checks · ${detail.headSha.slice(0, 7)}`}>
            <ul className="flex flex-col gap-1.5">
                {runs.map((run) => (
                    <CheckRunRow key={`${run.name}-${run.url ?? ""}`} run={run} />
                ))}
            </ul>
        </SidebarBlock>
    );
}

function CheckRunRow({ run }: { run: CheckRun }) {
    return (
        <li className="flex items-center gap-2">
            <ChecksDot state={run.state} />
            {run.url ? (
                <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate hover:text-foreground"
                >
                    {run.name}
                </a>
            ) : (
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
            )}
        </li>
    );
}

function Sidebar({ headline, detail }: { headline: Headline; detail: PullRequestDetail | null }) {
    return (
        <aside className="flex flex-col gap-5 text-sm">
            <ChecksPanel detail={detail} />

            {detail === null ? (
                <div className="flex flex-col divide-y text-sm">
                    <SidebarBlock title="Reviewers">
                        <p className="text-muted-foreground">…</p>
                    </SidebarBlock>
                    <SidebarBlock title="Assignees">
                        <p className="text-muted-foreground">…</p>
                    </SidebarBlock>
                    <SidebarBlock title="Labels">
                        <p className="text-muted-foreground">…</p>
                    </SidebarBlock>
                </div>
            ) : (
                <PullRequestSidebarMetadata detail={detail} reviewers={headline.reviewers} />
            )}
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
