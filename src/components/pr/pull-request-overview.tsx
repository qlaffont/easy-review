import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import {
    ArrowLeft,
    Check,
    ChevronDown,
    Copy,
    CornerDownLeft,
    ExternalLink,
    FileDiff,
    GitBranch,
    GitCommitHorizontal,
    GitMerge,
    GitPullRequest,
    GitPullRequestDraft,
    Inbox,
    ListChecks,
    MessageSquare,
    Pencil,
    RefreshCw,
    X,
    XCircle,
} from "lucide-react";
import { useRef, useState, useEffect, lazy, Suspense, type ReactNode } from "react";

import type { PullRequestPage } from "#/lib/session/session.ts";
import type { PullRequestDetail, PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { CommentActionsMenu, quoteMarkdown } from "#/components/pr/comment-actions.tsx";
import { EditedMeta } from "#/components/pr/edited-meta.tsx";
import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { PullRequestControls } from "#/components/pr/pull-request-controls.tsx";
import { PullRequestCopyMenu } from "#/components/pr/pull-request-copy-menu.tsx";
import { ReactionBar } from "#/components/pr/reaction-bar.tsx";
import { RelatedPullRequestsSidebar } from "#/components/pr/related-pull-requests.tsx";
import { ReviewChangesMenu } from "#/components/pr/review-changes-menu.tsx";
import { PullRequestSidebarMetadata } from "#/components/pr/sidebar-metadata.tsx";
import { SuggestionBatchBar } from "#/components/pr/suggestion-apply.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "#/components/ui/command.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
    ConversationLoadingSkeleton,
    DescriptionLoadingSkeleton,
    FileListLoadingSkeleton,
    PullRequestLoadingSkeleton,
    SidebarMetadataLoadingSkeleton,
} from "#/components/ui/loading.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { pullRequestSeo, usePageSeo } from "#/lib/seo.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { useCheckStatusRevalidate } from "#/lib/session/quiet-revalidate.ts";
import { notifyAction, notifyCopied, notifyError } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const PullRequestConversation = lazy(() =>
    import("#/components/pr/conversation.tsx").then((module) => ({ default: module.PullRequestConversation })),
);

const PullRequestCommits = lazy(() =>
    import("#/components/pr/pull-request-commits.tsx").then((module) => ({ default: module.PullRequestCommits })),
);

const ReviewChanges = lazy(() =>
    import("#/components/pr/review-changes.tsx").then((module) => ({ default: module.ReviewChanges })),
);

/** What a row and a full detail agree on, which is all the page header needs. */
type Headline = PullRequestSummary;

function scrollToSection(id: string) {
    const hash = id === "review" ? "review" : id;
    if (window.location.hash !== `#${hash}`) {
        history.replaceState(null, "", `#${hash}`);
    }

    // Defer until after React paint so layout (sticky bar, tab state) is settled.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const el = document.getElementById(id);
            if (!el) {
                return;
            }
            const marginTop = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
            const top = el.getBoundingClientRect().top + window.scrollY - marginTop;
            window.scrollTo({ top, behavior: "smooth" });
        });
    });
}

type OverviewTab = "conversation" | "commits";

function tabFromHash(hash: string): OverviewTab {
    return hash.replace(/^#/, "") === "commits" ? "commits" : "conversation";
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
    const [quoteInsert, setQuoteInsert] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<OverviewTab>(() =>
        typeof window === "undefined" ? "conversation" : tabFromHash(window.location.hash),
    );
    useSetActionTarget(headline ? targetFromSummary(headline) : null);

    const [owner = repository, repo = repository] = repository.split("/");
    usePageSeo(
        pullRequestSeo({
            owner,
            repo,
            number,
            title: headline?.title ?? null,
        }),
    );

    useEffect(() => {
        session.invalidateInbox();
        void session.loadPullRequest(repository, number);
        void session.loadPullRequestFiles(repository, number);
    }, [session, repository, number]);

    useCheckStatusRevalidate(() => {
        void session.revalidatePullRequest(repository, number);
    });

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
        const hash = window.location.hash;
        if (hash === "#conversation" || hash === "#commits") {
            setActiveTab(tabFromHash(hash));
            return;
        }
        if (hash === "#review" || initialPath) {
            requestAnimationFrame(() => scrollToSection("review"));
        }
    }, [initialPath, headline?.key]);

    function selectTab(tab: OverviewTab) {
        setActiveTab(tab);
        if (window.location.hash !== `#${tab}`) {
            history.replaceState(null, "", `#${tab}`);
        }
        if (tab === "commits") {
            void session.loadPullRequestCommits(repository, number);
        }
    }

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

                <PullRequestTabNav headline={headline} detail={page.detail} active={activeTab} onSelect={selectTab} />

                {page.error ? <p className="text-sm text-destructive">{page.error.message}</p> : null}

                {activeTab === "conversation" ? (
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
                        <div id="conversation" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
                            <Description
                                detail={page.detail}
                                headline={headline}
                                isLoading={page.detail === null}
                                baseUrl={blobBaseUrl(headline)}
                                onQuote={(body) => setQuoteInsert(quoteMarkdown(body))}
                            />
                            <Suspense fallback={<ConversationLoadingSkeleton />}>
                                <PullRequestConversation
                                    repository={repository}
                                    number={number}
                                    baseUrl={blobBaseUrl(headline)}
                                    canComment
                                    canClose={page.detail?.state === "open"}
                                    quoteInsert={quoteInsert}
                                    onQuoteApplied={() => setQuoteInsert(null)}
                                    onQuote={(body) => setQuoteInsert(quoteMarkdown(body))}
                                />
                            </Suspense>
                            {page.detail ? (
                                <PullRequestControls
                                    key={`${page.detail.updatedAt}-${page.detail.isDraft}-${page.detail.state}`}
                                    detail={page.detail}
                                />
                            ) : null}
                        </div>
                        <Sidebar headline={headline} detail={page.detail} />
                    </div>
                ) : null}

                {activeTab === "commits" ? (
                    <Suspense fallback={<FileListLoadingSkeleton />}>
                        <PullRequestCommits repository={repository} number={number} />
                    </Suspense>
                ) : null}

                <Suspense fallback={<FileListLoadingSkeleton />}>
                    <ReviewChanges repository={repository} number={number} initialPath={initialPath} />
                </Suspense>
            </div>
            <SuggestionBatchBar repository={repository} number={number} />
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
                <PullRequestLoadingSkeleton repository={page.repository} number={page.number} />
            )}
        </div>
    );
}

function BackToInbox() {
    return (
        <Link
            to="/"
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-1 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-500/15 hover:text-sky-950 dark:text-sky-200 dark:hover:bg-sky-500/20 dark:hover:text-sky-50"
        >
            <ArrowLeft className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
            <Inbox className="size-3.5 shrink-0" aria-hidden="true" />
            Inbox
        </Link>
    );
}

function PullRequestTabNav({
    headline,
    detail,
    active,
    onSelect,
}: {
    headline: Headline;
    detail: PullRequestDetail | null;
    active: OverviewTab;
    onSelect: (tab: OverviewTab) => void;
}) {
    const checksCount = detail?.checkCount ?? null;
    const commitsCount = detail?.commitCount ?? null;
    const [filesActive, setFilesActive] = useState(
        () => typeof window !== "undefined" && window.location.hash === "#review",
    );

    useEffect(() => {
        function syncFromHash() {
            setFilesActive(window.location.hash === "#review");
        }
        window.addEventListener("hashchange", syncFromHash);
        return () => window.removeEventListener("hashchange", syncFromHash);
    }, []);

    return (
        <nav
            aria-label="Pull request sections"
            className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b"
        >
            <div className="flex min-w-0 flex-wrap items-end gap-1" role="tablist">
                <OverviewTabButton
                    active={active === "conversation" && !filesActive}
                    icon={<MessageSquare className="size-3.5" aria-hidden="true" />}
                    label="Conversation"
                    count={headline.commentCount}
                    onClick={() => {
                        setFilesActive(false);
                        onSelect("conversation");
                    }}
                />
                <OverviewTabButton
                    active={active === "commits" && !filesActive}
                    icon={<GitCommitHorizontal className="size-3.5" aria-hidden="true" />}
                    label="Commits"
                    count={commitsCount}
                    onClick={() => {
                        setFilesActive(false);
                        onSelect("commits");
                    }}
                />
                <OverviewTabButton
                    active={false}
                    icon={<ListChecks className="size-3.5" aria-hidden="true" />}
                    label="Checks"
                    count={checksCount}
                    onClick={() => {
                        window.open(`${headline.url}/checks`, "_blank", "noreferrer");
                    }}
                />
                <OverviewTabButton
                    active={filesActive}
                    icon={<FileDiff className="size-3.5" aria-hidden="true" />}
                    label="Files changed"
                    count={headline.changedFiles}
                    onClick={() => {
                        setFilesActive(true);
                        scrollToSection("review");
                    }}
                />
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-2 text-xs tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">+{headline.additions}</span>
                <span className="text-red-600 dark:text-red-400">−{headline.deletions}</span>
                <OverviewDiffStat additions={headline.additions} deletions={headline.deletions} />
            </div>
        </nav>
    );
}

function OverviewTabButton({
    active,
    icon,
    label,
    count,
    onClick,
}: {
    active: boolean;
    icon: ReactNode;
    label: string;
    count: number | null;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className={cn(
                "relative inline-flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
        >
            {icon}
            <span>{label}</span>
            {count != null ? (
                <span
                    className={cn(
                        "rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums",
                        active ? "bg-muted text-foreground" : "bg-muted/80 text-muted-foreground",
                    )}
                >
                    {count}
                </span>
            ) : (
                <span className="size-4 rounded-full bg-muted/80" aria-hidden="true" />
            )}
        </button>
    );
}

function OverviewDiffStat({ additions, deletions }: { additions: number; deletions: number }) {
    const total = additions + deletions;
    if (total === 0) {
        return null;
    }

    const blocks = 5;
    const addBlocks = Math.round((additions / total) * blocks);
    const delBlocks = Math.min(blocks - addBlocks, Math.round((deletions / total) * blocks));

    return (
        <span className="inline-flex gap-px" aria-hidden="true">
            {Array.from({ length: blocks }, (_, index) => (
                <span
                    key={index}
                    className={cn(
                        "h-2.5 w-2 rounded-[1px]",
                        index < addBlocks
                            ? "bg-emerald-500"
                            : index < addBlocks + delBlocks
                              ? "bg-red-500"
                              : "border border-muted-foreground/30 bg-transparent",
                    )}
                />
            ))}
        </span>
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

function BaseBranchSwitcher({
    value,
    branches,
    loading,
    disabled,
    onChange,
}: {
    value: string;
    branches: Array<string>;
    loading: boolean;
    disabled?: boolean;
    onChange: (branch: string) => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || loading}
                    className="max-w-[min(20rem,70vw)] gap-1.5 font-mono text-xs"
                    aria-label={`Base branch ${value}. Switch base branch`}
                >
                    <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate">{loading ? "Loading…" : value}</span>
                    <ChevronDown className="size-3.5 opacity-50" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
                <div className="flex items-center justify-between border-b px-3 py-2">
                    <p className="text-sm font-semibold">Switch branches</p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        aria-label="Close"
                        onClick={() => setOpen(false)}
                    >
                        <X className="size-3.5" aria-hidden="true" />
                    </Button>
                </div>
                <Command>
                    <CommandInput placeholder="Find a branch..." />
                    <CommandList className="max-h-64">
                        <CommandEmpty>No branches found.</CommandEmpty>
                        <CommandGroup>
                            {branches.map((branch) => {
                                const selected = branch === value;
                                return (
                                    <CommandItem
                                        key={branch}
                                        value={branch}
                                        onSelect={() => {
                                            onChange(branch);
                                            setOpen(false);
                                        }}
                                        className="font-mono text-xs"
                                    >
                                        <Check
                                            className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")}
                                            aria-hidden="true"
                                        />
                                        <span className="min-w-0 flex-1 truncate">{branch}</span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function TruncatedTitle({ title, className }: { title: string; className?: string }) {
    const textRef = useRef<HTMLButtonElement>(null);
    const [truncated, setTruncated] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const el = textRef.current;
        if (!el) {
            return;
        }

        const update = () => {
            setTruncated(el.scrollWidth > el.clientWidth + 1);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [title]);

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next && !truncated) {
                    return;
                }
                setOpen(next);
            }}
        >
            <h1 className="min-w-0 flex-1">
                <PopoverTrigger asChild>
                    <button
                        ref={textRef}
                        type="button"
                        disabled={!truncated}
                        className={cn(
                            "block w-full truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2",
                            truncated ? "cursor-pointer" : "cursor-default disabled:opacity-100",
                            className,
                        )}
                        aria-label={truncated ? `Show full title: ${title}` : undefined}
                    >
                        {title}
                    </button>
                </PopoverTrigger>
            </h1>
            <PopoverContent
                align="start"
                className="w-[min(32rem,calc(100vw-2rem))] p-3 text-sm font-semibold break-words"
            >
                {title}
            </PopoverContent>
        </Popover>
    );
}

/** Compact chrome that sticks to the top once the page title scrolls away. */
function StickyPullRequestBar({ headline, visible }: { headline: Headline; visible: boolean }) {
    return (
        <div
            aria-hidden={!visible}
            inert={!visible ? true : undefined}
            className={cn(
                "fixed inset-x-0 top-0 z-30 border-b bg-background/95 shadow-sm backdrop-blur transition duration-200",
                visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
            )}
        >
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
                <StateBadge pullRequest={headline} compact />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <button
                            type="button"
                            className="truncate text-left text-sm font-semibold tracking-tight cursor-pointer hover:underline"
                            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                        >
                            {headline.title}
                        </button>
                        <span className="shrink-0 text-sm text-muted-foreground">#{headline.number}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0">by {headline.author}</span>
                        <CopyableBranch name={headline.baseRefName} tone="sky" compact />
                        <span aria-hidden="true" className="shrink-0">
                            ←
                        </span>
                        <CopyableBranch name={headline.headRefName} tone="sky" compact />
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
    const [editing, setEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState(headline.title);
    const [baseDraft, setBaseDraft] = useState(headline.baseRefName);
    const [branches, setBranches] = useState<Array<string>>([]);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const busyRef = useRef(false);
    const isOpen = (page.detail?.state ?? headline.state) === "open";
    const isDraft = page.detail?.isDraft ?? headline.isDraft;

    useEffect(() => {
        if (!editing) {
            setTitleDraft(headline.title);
            setBaseDraft(headline.baseRefName);
        }
    }, [headline.title, headline.baseRefName, editing]);

    async function run(
        action: () => Promise<void>,
        messages: { loading: string; success: string; error?: string },
    ): Promise<boolean> {
        if (busyRef.current) {
            return false;
        }

        busyRef.current = true;
        setBusy(true);
        setActionError(null);
        try {
            await notifyAction(action, messages);
            return true;
        } catch (cause) {
            setActionError(cause instanceof Error ? cause.message : "That action failed.");
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function openEditor() {
        setTitleDraft(headline.title);
        setBaseDraft(headline.baseRefName);
        setEditing(true);
        setLoadingBranches(true);
        try {
            const names = await session.listRepositoryBranches(page.repository);
            const withCurrent = names.includes(headline.baseRefName) ? names : [headline.baseRefName, ...names];
            setBranches(withCurrent);
        } catch {
            setBranches([headline.baseRefName, headline.headRefName].filter(Boolean));
        } finally {
            setLoadingBranches(false);
        }
    }

    async function saveEdits() {
        const nextTitle = titleDraft.trim();
        if (!nextTitle) {
            setActionError("Title cannot be empty.");
            return;
        }

        const titleChanged = nextTitle !== headline.title;
        const baseChanged = baseDraft !== headline.baseRefName;
        if (!titleChanged && !baseChanged) {
            setEditing(false);
            return;
        }

        const ok = await run(
            () =>
                session.updatePullRequest(page.repository, page.number, {
                    ...(titleChanged ? { title: nextTitle } : {}),
                    ...(baseChanged ? { base: baseDraft } : {}),
                }),
            {
                loading: "Updating pull request…",
                success: "Pull request updated",
                error: "Could not update the pull request.",
            },
        );
        if (ok) {
            setEditing(false);
        }
    }

    return (
        <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <BackToInbox />
                <div className="flex flex-wrap items-center justify-end gap-1">
                    {page.refreshing ? (
                        <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
                            <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                            Syncing…
                        </span>
                    ) : null}
                    <HelpTooltip label="Reload this pull request from GitHub (⌘R)">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-8 shrink-0 text-muted-foreground"
                            disabled={page.refreshing || busy || editing}
                            aria-label="Refresh pull request"
                            onClick={() =>
                                void notifyAction(() => session.refreshPullRequest(page.repository, page.number), {
                                    loading: "Refreshing pull request…",
                                    success: "Pull request refreshed",
                                    error: "Could not refresh the pull request.",
                                })
                            }
                        >
                            <RefreshCw className={cn("size-3.5", page.refreshing && "animate-spin")} />
                        </Button>
                    </HelpTooltip>
                    <PullRequestCopyMenu
                        repository={headline.repository}
                        number={headline.number}
                        title={headline.title}
                        githubUrl={headline.url}
                        headRefName={headline.headRefName}
                    />
                    {isOpen ? (
                        <HelpTooltip
                            label={
                                isDraft
                                    ? "Mark this pull request ready for review"
                                    : "Convert this pull request back to a draft"
                            }
                        >
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy || page.refreshing || editing}
                                className={
                                    isDraft
                                        ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 hover:text-emerald-900 dark:border-emerald-500/40 dark:text-emerald-200 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-100"
                                        : "border-muted-foreground/25 bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                                }
                                onClick={() =>
                                    void run(
                                        async () => {
                                            await session.setPullRequestDraft(page.repository, page.number, !isDraft);
                                        },
                                        isDraft
                                            ? {
                                                  loading: "Marking ready for review…",
                                                  success: "Marked ready for review",
                                                  error: "Could not update draft status.",
                                              }
                                            : {
                                                  loading: "Converting to draft…",
                                                  success: "Converted to draft",
                                                  error: "Could not update draft status.",
                                              },
                                    )
                                }
                            >
                                {isDraft ? "Ready for review" : "Convert to draft"}
                            </Button>
                        </HelpTooltip>
                    ) : null}
                    <ReviewChangesMenu repository={page.repository} number={page.number} />
                </div>
            </div>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

            {editing ? (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            value={titleDraft}
                            disabled={busy}
                            autoFocus
                            className="min-w-0 flex-1 text-base font-semibold"
                            aria-label="Pull request title"
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveEdits();
                                }
                                if (event.key === "Escape") {
                                    setEditing(false);
                                    setActionError(null);
                                }
                            }}
                        />
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                                setEditing(false);
                                setActionError(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={busy || !titleDraft.trim()}
                            className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                            onClick={() => void saveEdits()}
                        >
                            Save
                            <CornerDownLeft className="size-3.5" aria-hidden="true" />
                        </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <StateBadge pullRequest={headline} />
                        <BaseBranchSwitcher
                            value={baseDraft}
                            branches={branches}
                            loading={loadingBranches}
                            disabled={busy}
                            onChange={setBaseDraft}
                        />
                        <span aria-hidden="true" className="text-muted-foreground">
                            ←
                        </span>
                        <CopyableBranch name={headline.headRefName} tone="sky" />
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex min-w-0 items-center gap-2">
                        <StateBadge pullRequest={headline} />
                        <TruncatedTitle title={headline.title} className="text-xl font-semibold tracking-tight" />
                        {isOpen ? (
                            <HelpTooltip label="Edit title and base branch">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-8 shrink-0 text-muted-foreground"
                                    aria-label="Edit pull request"
                                    disabled={busy}
                                    onClick={() => void openEditor()}
                                >
                                    <Pencil className="size-3.5" aria-hidden="true" />
                                </Button>
                            </HelpTooltip>
                        ) : null}
                        <HelpTooltip label="Open on GitHub">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-8 shrink-0 text-muted-foreground"
                                asChild
                            >
                                <a href={headline.url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="size-3.5" aria-hidden="true" />
                                    <span className="sr-only">Open on GitHub</span>
                                </a>
                            </Button>
                        </HelpTooltip>
                    </div>

                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                            <AuthorAvatar login={headline.author} avatarUrl={headline.authorAvatarUrl} />
                            {headline.author}
                        </span>
                        <span className="inline-flex flex-wrap items-center gap-x-1">
                            opened {page.repository}#{page.number} <RelativeTime iso={headline.createdAt} />
                        </span>
                        <span aria-hidden="true">·</span>
                        <CopyableBranch name={headline.baseRefName} tone="sky" />
                        <span aria-hidden="true">←</span>
                        <CopyableBranch name={headline.headRefName} tone="sky" />
                    </p>
                </>
            )}
        </header>
    );
}

function AuthorAvatar({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
    const resolved =
        avatarUrl ?? (/^[\w-]+$/.test(login) && login !== "ghost" ? `https://github.com/${login}.png?size=40` : null);

    if (resolved) {
        return <img src={resolved} alt="" className="size-5 shrink-0 rounded-full" />;
    }

    return (
        <span
            aria-hidden="true"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase"
        >
            {login.slice(0, 1)}
        </span>
    );
}

/** Click-to-copy branch pill — sky tone matches the sticky bar chrome. */
function CopyableBranch({
    name,
    tone = "muted",
    compact = false,
}: {
    name: string;
    tone?: "muted" | "sky";
    compact?: boolean;
}) {
    return (
        <HelpTooltip label={`Copy ${name}`}>
            <button
                type="button"
                className={cn(
                    "inline-flex min-w-0 cursor-pointer items-center gap-1 font-mono transition-colors",
                    compact ? "rounded-full px-2 py-0.5 text-[11px]" : "rounded px-1.5 py-0.5 text-xs",
                    tone === "sky"
                        ? "bg-sky-500/10 text-sky-800 hover:bg-sky-500/15 dark:text-sky-200"
                        : "bg-muted text-foreground hover:bg-muted/80",
                )}
                onClick={() => {
                    void navigator.clipboard.writeText(name).then(
                        () => notifyCopied("branch name"),
                        () => notifyError("Could not copy branch name"),
                    );
                }}
            >
                <code className={cn("truncate", compact ? "max-w-[min(12rem,28vw)]" : "max-w-48")}>{name}</code>
                <Copy
                    className={cn(
                        "shrink-0",
                        compact ? "size-2.5" : "size-3",
                        tone === "sky" ? "opacity-70" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                />
                <span className="sr-only">Copy {name}</span>
            </button>
        </HelpTooltip>
    );
}

/** Where GitHub itself resolves the relative links someone wrote in a description. */
function blobBaseUrl(pullRequest: Headline): string {
    return `https://github.com/${pullRequest.repository}/blob/${pullRequest.baseRefName}/`;
}

function Description({
    detail,
    headline,
    isLoading,
    baseUrl,
    onQuote,
}: {
    detail: PullRequestDetail | null;
    headline: Headline;
    isLoading: boolean;
    baseUrl: string;
    onQuote: (body: string) => void;
}) {
    const session = useSession();
    const viewer = useSelector(session.state, (state) => state.auth.viewer);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const body = detail?.body ?? "";
    const canEdit = detail?.state === "open" && viewer?.login === headline.author;

    async function save() {
        if (!detail || saving) {
            return;
        }
        setSaving(true);
        try {
            await notifyAction(() => session.updatePullRequestBody(detail.repository, detail.number, draft), {
                loading: "Updating description…",
                success: "Description updated",
                error: "Could not update the description.",
            });
            setEditing(false);
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="overflow-hidden rounded-lg border bg-background">
            <h2 className="sr-only">Description</h2>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                <AuthorAvatar login={headline.author} avatarUrl={headline.authorAvatarUrl} />
                <span className="font-semibold">{headline.author}</span>
                <RelativeTime iso={headline.createdAt} className="text-muted-foreground" />
                {detail ? (
                    <EditedMeta
                        lastEditedAt={detail.lastEditedAt}
                        editor={detail.editor}
                        editCount={detail.editCount}
                        edits={detail.edits}
                        createdAt={headline.createdAt}
                        authorLogin={headline.author}
                        authorAvatarUrl={headline.authorAvatarUrl}
                    />
                ) : null}
                <div className="ml-auto flex items-center gap-0.5">
                    {canEdit && !editing ? (
                        <HelpTooltip label="Edit description">
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="size-7 text-muted-foreground"
                                aria-label="Edit description"
                                onClick={() => {
                                    setDraft(body);
                                    setEditing(true);
                                }}
                            >
                                <Pencil className="size-3.5" aria-hidden="true" />
                            </Button>
                        </HelpTooltip>
                    ) : null}
                    <CommentActionsMenu
                        url={headline.url}
                        body={body}
                        canEdit={canEdit}
                        onEdit={
                            canEdit
                                ? () => {
                                      setDraft(body);
                                      setEditing(true);
                                  }
                                : undefined
                        }
                        onQuote={body.trim() ? () => onQuote(body) : undefined}
                    />
                </div>
            </header>

            {isLoading ? (
                <div className="p-4">
                    <DescriptionLoadingSkeleton />
                </div>
            ) : editing ? (
                <div className="flex flex-col gap-2 p-3">
                    <MarkdownComposer
                        value={draft}
                        onChange={setDraft}
                        disabled={saving}
                        rows={6}
                        placeholder="Add a description…"
                        previewBaseUrl={baseUrl}
                        repository={headline.repository}
                        pullRequestNumber={headline.number}
                        onSubmitKey={() => void save()}
                        footer={
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => setEditing(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={saving}
                                    className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                                    onClick={() => void save()}
                                >
                                    {saving ? "Saving…" : "Update comment"}
                                </Button>
                            </>
                        }
                    />
                </div>
            ) : (
                <div className="px-3 py-3">
                    {body.trim() ? (
                        <Markdown source={body} baseUrl={baseUrl} />
                    ) : (
                        <p className="text-sm italic text-muted-foreground">No description provided.</p>
                    )}
                </div>
            )}

            {detail && !editing ? (
                <div className="border-t px-3 py-2">
                    <ReactionBar
                        groups={detail.reactionGroups}
                        onToggle={(content) => {
                            void notifyAction(
                                () => session.toggleIssueReaction(detail.repository, detail.number, content),
                                {
                                    loading: "Updating reaction…",
                                    success: "Reaction updated",
                                    error: "Could not update the reaction.",
                                },
                            );
                        }}
                    />
                </div>
            ) : null}
        </section>
    );
}

function Sidebar({ headline, detail }: { headline: Headline; detail: PullRequestDetail | null }) {
    if (detail === null) {
        return (
            <aside className="flex flex-col gap-5 text-sm">
                <RelatedPullRequestsSidebar
                    repository={headline.repository}
                    number={headline.number}
                    headRefName={headline.headRefName}
                    baseRefName={headline.baseRefName}
                />
                <SidebarMetadataLoadingSkeleton />
            </aside>
        );
    }

    return (
        <aside className="flex flex-col gap-5 text-sm">
            <RelatedPullRequestsSidebar
                repository={detail.repository}
                number={detail.number}
                headRefName={detail.headRefName}
                baseRefName={detail.baseRefName}
            />
            <PullRequestSidebarMetadata detail={detail} reviewers={headline.reviewers} />
        </aside>
    );
}
