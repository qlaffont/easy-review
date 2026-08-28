import { useNavigate } from "@tanstack/react-router";
import {
    Check,
    ChevronDown,
    ChevronRight,
    FolderGit2,
    GitMerge,
    Keyboard,
    Loader2,
    RefreshCw,
    Settings,
} from "lucide-react";
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";

import type { InboxSection, InboxSectionId, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";
import type { MergeMethod, PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { emptySectionRow, PullRequestRow } from "#/components/inbox/pull-request-row.tsx";
import { visualForSection } from "#/components/inbox/section-visuals.ts";
import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { InboxLoadingSkeleton, LazyChunkFallback } from "#/components/ui/loading.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { openInboxPullRequest } from "#/lib/inbox/inbox-navigation.ts";
import { useInboxStackBadges } from "#/lib/query/inbox-stack.ts";
import { useInboxQuery } from "#/lib/query/inbox.ts";
import { invalidateInboxAfterRepoSelection } from "#/lib/query/invalidate.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { describeAutoMergeBatchResult, queuedAutoMergeKey } from "#/lib/session/queued-auto-merge.ts";
import { useQuietRevalidate } from "#/lib/session/quiet-revalidate.ts";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const SectionFilterEditor = lazy(() =>
    import("#/components/inbox/section-filter-editor.tsx").then((module) => ({ default: module.SectionFilterEditor })),
);

const SectionAppearanceEditor = lazy(() =>
    import("#/components/inbox/section-appearance-editor.tsx").then((module) => ({
        default: module.SectionAppearanceEditor,
    })),
);

/** How many pull requests each expanded section shows before “Load more…”. */
const INBOX_SECTION_PAGE_SIZE = 10;
const APPROVED_SECTION_ID = "approved";
const MERGE_BUTTON_CLASS = "bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]";
const INBOX_AUTO_MERGE_METHODS: Array<{
    value: MergeMethod;
    label: string;
    buttonLabel: string;
    description: string;
    verb: string;
}> = [
    {
        value: "merge",
        label: "Create a merge commit",
        buttonLabel: "Merge all",
        description: "All commits from each branch are added to the base branch via a merge commit.",
        verb: "merge",
    },
    {
        value: "squash",
        label: "Squash and merge",
        buttonLabel: "Squash and merge all",
        description: "Each pull request is combined into one commit on the base branch.",
        verb: "squash",
    },
    {
        value: "rebase",
        label: "Rebase and merge",
        buttonLabel: "Rebase and merge all",
        description: "All commits from each branch are rebased onto the base branch.",
        verb: "rebase",
    },
];

export function InboxBoard() {
    const session = useSession();
    const navigate = useNavigate();
    const openRepoPicker = useOpenRepoPicker();
    const {
        data,
        sections,
        sectionFetching,
        sectionErrors,
        isLoading,
        isFetching,
        isError,
        error,
        refresh,
        refreshSection,
        revalidate,
    } = useInboxQuery();
    const login = useSessionState((state) => state.auth.viewer?.login ?? "");
    const inboxUi = useSessionState((state) => state.inbox);
    const queuedAutoMerges = useSessionState((state) => state.queuedAutoMerges);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    const sectionLayout = inboxUi.sectionLayout;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [visibleCountBySection, setVisibleCountBySection] = useState<Partial<Record<InboxSectionId, number>>>({});
    const [filterSectionId, setFilterSectionId] = useState<InboxSectionId | null>(null);
    const [appearanceSectionId, setAppearanceSectionId] = useState<InboxSectionId | null>(null);
    const previousSelectedCount = useRef<number | null>(null);

    function visibleCountFor(id: InboxSectionId): number {
        return visibleCountBySection[id] ?? INBOX_SECTION_PAGE_SIZE;
    }

    const flatRows = sections
        .filter((section) => inboxUi.expandedSections.includes(section.id))
        .flatMap((section) => section.pullRequests.slice(0, visibleCountFor(section.id)));
    const stackBadges = useInboxStackBadges(flatRows);
    const queuedAutoMergeKeys = new Set(
        queuedAutoMerges.map((item) => queuedAutoMergeKey(item.repository, item.number)),
    );
    const selected = flatRows.find((pullRequest) => pullRequest.key === selectedKey) ?? flatRows[0] ?? null;

    useSetActionTarget(selected ? targetFromSummary(selected) : null);

    useEffect(() => {
        if (selected && selected.key !== selectedKey) {
            setSelectedKey(selected.key);
        }
        if (!selected && selectedKey !== null) {
            setSelectedKey(null);
        }
    }, [selected, selectedKey]);

    const moveSelection = useEffectEvent((delta: number) => {
        if (flatRows.length === 0) {
            return;
        }

        const currentIndex = Math.max(
            0,
            flatRows.findIndex((pullRequest) => pullRequest.key === selected?.key),
        );
        const nextIndex = Math.min(flatRows.length - 1, Math.max(0, currentIndex + delta));
        setSelectedKey(flatRows[nextIndex]!.key);
    });

    const openSelected = useEffectEvent(() => {
        if (!selected) {
            return;
        }

        openInboxPullRequest(selected, (repository, number) => {
            const [owner = "", repo = ""] = repository.split("/");
            void navigate({
                to: "/pr/$owner/$repo/$number",
                params: { owner, repo, number: String(number) },
            });
        });
    });

    // Refetch when the allowlist changes — not on first paint (refetchOnMount covers stale cache).
    useEffect(() => {
        if (previousSelectedCount.current === null) {
            previousSelectedCount.current = selectedCount;
            return;
        }
        if (previousSelectedCount.current !== selectedCount && login) {
            invalidateInboxAfterRepoSelection(session.queryClient, login);
            previousSelectedCount.current = selectedCount;
        }
    }, [session.queryClient, login, selectedCount]);

    // After review / merge, return navigation marks the inbox stale — reload every section from GitHub.
    useEffect(() => {
        if (inboxUi.stale && selectedCount > 0 && !inboxUi.refreshing) {
            void session.refreshInbox();
        }
    }, [inboxUi.stale, inboxUi.refreshing, selectedCount, session]);

    useQuietRevalidate(() => {
        void revalidate({ background: true });
    });

    useEffect(() => {
        function revalidateWhenVisible() {
            if (document.visibilityState === "visible") {
                void revalidate({ background: true });
            }
        }

        document.addEventListener("visibilitychange", revalidateWhenVisible);
        window.addEventListener("focus", revalidateWhenVisible);

        return () => {
            document.removeEventListener("visibilitychange", revalidateWhenVisible);
            window.removeEventListener("focus", revalidateWhenVisible);
        };
    }, [revalidate]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (
                target.isContentEditable ||
                target.closest("input, textarea, select, button, a, [role='button'], [role='menuitem']")
            ) {
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                openSelected();
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    if (selectedCount === 0) {
        return (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-sky-500/30 bg-sky-500/4 p-8">
                <span className="grid size-10 place-items-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300">
                    <FolderGit2 className="size-5" aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">No repositories selected</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                        Pick the repositories you triage and their pull requests will show up here.
                    </p>
                </div>
                <Button onClick={openRepoPicker}>Choose repositories</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="sticky top-12 z-10 -mx-4 border-b bg-background px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {isFetching ? (
                            <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                                <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                                Syncing with GitHub…
                            </span>
                        ) : data?.lastLoadedAt ? (
                            <span className="inline-flex items-center gap-1">
                                Updated <RelativeTime iso={data.lastLoadedAt} />
                            </span>
                        ) : (
                            "Not synced yet"
                        )}
                        <span className="hidden items-center gap-1 sm:inline-flex">
                            <span aria-hidden="true">·</span>
                            <Keyboard className="size-3" aria-hidden="true" />
                            ↑/↓ select · Enter open · ⌘K commands
                        </span>
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={isFetching}
                            onClick={() =>
                                void notifyAction(() => refresh(), {
                                    loading: "Refreshing inbox…",
                                    success: "Inbox refreshed",
                                    error: "Could not refresh the inbox.",
                                })
                            }
                        >
                            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
                            Refresh
                        </Button>
                    </div>
                </div>
            </div>

            {isError && error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error instanceof Error ? error.message : "Could not load the inbox."}
                </p>
            ) : null}

            {isLoading && !data ? (
                <InboxLoadingSkeleton />
            ) : (
                <div className="flex flex-col gap-2">
                    {sections.map((section) => {
                        const layoutEntry = sectionLayout.find((entry) => entry.id === section.id);
                        const isExpanded = inboxUi.expandedSections.includes(section.id);
                        const visibleCount = visibleCountFor(section.id);
                        return (
                            <InboxSectionPanel
                                key={section.id}
                                section={section}
                                color={layoutEntry?.color}
                                customColor={layoutEntry?.customColor}
                                icon={layoutEntry?.icon}
                                selectedKey={selected?.key ?? null}
                                isExpanded={isExpanded}
                                isFetching={sectionFetching[section.id] ?? false}
                                sectionError={sectionErrors[section.id] ?? null}
                                stackBadges={stackBadges}
                                queuedAutoMergeKeys={queuedAutoMergeKeys}
                                visibleCount={visibleCount}
                                onToggle={() => {
                                    if (isExpanded) {
                                        setVisibleCountBySection((current) => {
                                            const next = { ...current };
                                            delete next[section.id];
                                            return next;
                                        });
                                    }
                                    void session.toggleSection(section.id);
                                }}
                                onRefresh={() =>
                                    void notifyAction(() => refreshSection(section.id), {
                                        loading: `Refreshing ${section.label}…`,
                                        success: `${section.label} refreshed`,
                                        error: `Could not refresh ${section.label}.`,
                                    })
                                }
                                onAutoMergeAll={
                                    section.id === APPROVED_SECTION_ID
                                        ? async (method) => {
                                              while (session.canLoadMoreInboxSection(section.id)) {
                                                  await session.loadMoreInboxSection(section.id);
                                              }

                                              const latest = session
                                                  .getInboxSections()
                                                  .find((entry) => entry.id === section.id);
                                              const targets = (latest?.pullRequests ?? [])
                                                  .filter(
                                                      (pullRequest) =>
                                                          pullRequest.state === "open" && !pullRequest.isDraft,
                                                  )
                                                  .map((pullRequest) => ({
                                                      repository: pullRequest.repository,
                                                      number: pullRequest.number,
                                                  }));

                                              if (targets.length === 0) {
                                                  throw new Error("No open pull requests to auto-merge.");
                                              }

                                              const result = await session.queuePullRequestAutoMerges(targets, method);
                                              await refreshSection(section.id);
                                              return result;
                                          }
                                        : undefined
                                }
                                onEditFilters={() => setFilterSectionId(section.id)}
                                onChangeAppearance={() => setAppearanceSectionId(section.id)}
                                onLoadMore={() => {
                                    void (async () => {
                                        const nextVisible = visibleCount + INBOX_SECTION_PAGE_SIZE;

                                        if (nextVisible > section.pullRequests.length) {
                                            if (session.canLoadMoreInboxSection(section.id)) {
                                                await session.loadMoreInboxSection(section.id);
                                            }
                                        }

                                        setVisibleCountBySection((current) => ({
                                            ...current,
                                            [section.id]: nextVisible,
                                        }));
                                    })();
                                }}
                                loadingMore={inboxUi.loadingMoreSection === section.id}
                                canLoadMoreFromGitHub={session.canLoadMoreInboxSection(section.id)}
                                onSelect={setSelectedKey}
                            />
                        );
                    })}
                </div>
            )}

            {filterSectionId !== null ? (
                <Suspense fallback={<LazyChunkFallback label="Loading filter editor…" />}>
                    <SectionFilterEditor
                        sectionId={filterSectionId}
                        open
                        onOpenChange={(next) => {
                            if (!next) setFilterSectionId(null);
                        }}
                    />
                </Suspense>
            ) : null}
            {appearanceSectionId !== null ? (
                <Suspense fallback={<LazyChunkFallback label="Loading appearance…" />}>
                    <SectionAppearanceEditor
                        sectionId={appearanceSectionId}
                        open
                        onOpenChange={(next) => {
                            if (!next) setAppearanceSectionId(null);
                        }}
                    />
                </Suspense>
            ) : null}
        </div>
    );
}

function InboxSectionPanel({
    section,
    color,
    customColor,
    icon,
    selectedKey,
    isExpanded,
    isFetching,
    sectionError,
    stackBadges,
    queuedAutoMergeKeys,
    visibleCount,
    onToggle,
    onRefresh,
    onAutoMergeAll,
    onEditFilters,
    onChangeAppearance,
    onLoadMore,
    onSelect,
    loadingMore,
    canLoadMoreFromGitHub,
}: {
    section: InboxSection;
    color?: SectionColorId;
    customColor?: string | null;
    icon?: SectionIconId;
    selectedKey: string | null;
    isExpanded: boolean;
    isFetching?: boolean;
    sectionError?: string | null;
    stackBadges: Map<string, { position: number; total: number }>;
    queuedAutoMergeKeys: ReadonlySet<string>;
    visibleCount: number;
    onToggle: () => void;
    onRefresh: () => void;
    onAutoMergeAll?: (method: MergeMethod) => Promise<{
        queued: number;
        merged: ReadonlyArray<{ repository: string; number: number }>;
    }>;
    onEditFilters: () => void;
    onChangeAppearance: () => void;
    onLoadMore: () => void;
    onSelect: (key: string) => void;
    loadingMore: boolean;
    canLoadMoreFromGitHub: boolean;
}) {
    const visual = visualForSection(section.id, { color, customColor, icon });
    const Icon = visual.icon;
    const count = section.count;
    const loaded = section.pullRequests.length;
    const visiblePullRequests = section.pullRequests.slice(0, visibleCount);
    const hiddenLoaded = Math.max(0, loaded - visiblePullRequests.length);
    const showLoadMore = hiddenLoaded > 0 || canLoadMoreFromGitHub;
    const queuedCount = section.pullRequests.filter((pullRequest) => queuedAutoMergeKeys.has(pullRequest.key)).length;

    return (
        <section
            className={cn("overflow-hidden rounded-lg border border-l-[3px]", visual.accentClass)}
            style={visual.tones?.accent}
        >
            <h2 className={cn("flex items-stretch transition-colors", visual.headerClass)} style={visual.tones?.header}>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={isExpanded}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium"
                >
                    <ChevronRight
                        aria-hidden="true"
                        className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isExpanded && "rotate-90",
                        )}
                    />
                    <span
                        className={cn("grid size-6 shrink-0 place-items-center rounded-md", visual.chipClass)}
                        style={visual.tones?.chip}
                    >
                        <Icon
                            className={cn("size-3.5", visual.iconClass)}
                            style={visual.tones?.icon}
                            aria-hidden="true"
                        />
                    </span>
                    <span className="min-w-0 truncate">{section.label}</span>
                    {queuedCount > 0 ? (
                        <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            {queuedCount === 1 ? "1 auto-merging" : `${queuedCount} auto-merging`}
                        </span>
                    ) : null}
                    <span
                        className={cn(
                            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                            count > 0 ? visual.countClass : "bg-muted/80 text-muted-foreground",
                        )}
                        style={count > 0 ? visual.tones?.count : undefined}
                    >
                        {count}
                    </span>
                </button>
                <div className="flex shrink-0 items-center pr-1">
                    {onAutoMergeAll ? (
                        <InboxAutoMergeAllButton
                            sectionLabel={section.label}
                            count={count}
                            disabled={count === 0 || Boolean(isFetching)}
                            onAutoMergeAll={onAutoMergeAll}
                        />
                    ) : null}
                    <HelpTooltip label={`Refresh ${section.label}`}>
                        <span className="inline-flex">
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="my-1 size-7"
                                disabled={isFetching}
                                aria-label={`Refresh ${section.label}`}
                                onClick={onRefresh}
                            >
                                <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
                            </Button>
                        </span>
                    </HelpTooltip>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="my-1 size-7"
                                aria-label={`Section options for ${section.label}`}
                            >
                                <Settings className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={onEditFilters}>Edit filters…</DropdownMenuItem>
                            <DropdownMenuItem onSelect={onChangeAppearance}>Change appearance…</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </h2>

            {isExpanded ? (
                sectionError && section.pullRequests.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-destructive">{sectionError}</p>
                ) : section.pullRequests.length === 0 ? (
                    emptySectionRow
                ) : (
                    <div className="flex flex-col">
                        {visiblePullRequests.map((pullRequest) => (
                            <SelectableRow
                                key={pullRequest.key}
                                pullRequest={pullRequest}
                                selected={pullRequest.key === selectedKey}
                                stackBadge={stackBadges.get(pullRequest.key) ?? null}
                                autoMergeQueued={queuedAutoMergeKeys.has(pullRequest.key)}
                                onSelect={onSelect}
                            />
                        ))}
                        {showLoadMore ? (
                            <button
                                type="button"
                                disabled={loadingMore}
                                className="flex cursor-pointer items-center justify-center gap-2 border-t px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
                                onClick={onLoadMore}
                            >
                                {loadingMore ? (
                                    <>
                                        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                                        <span>Loading…</span>
                                    </>
                                ) : (
                                    "Load more"
                                )}
                            </button>
                        ) : null}
                    </div>
                )
            ) : null}
        </section>
    );
}

function InboxAutoMergeAllButton({
    sectionLabel,
    count,
    disabled,
    onAutoMergeAll,
}: {
    sectionLabel: string;
    count: number;
    disabled: boolean;
    onAutoMergeAll: (method: MergeMethod) => Promise<{
        queued: number;
        merged: ReadonlyArray<{ repository: string; number: number }>;
    }>;
}) {
    const [method, setMethod] = useState<MergeMethod>("squash");
    const [pending, setPending] = useState(false);
    const selected = INBOX_AUTO_MERGE_METHODS.find((entry) => entry.value === method) ?? INBOX_AUTO_MERGE_METHODS[1]!;
    const busy = disabled || pending;

    return (
        <AlertDialog>
            <div className="inline-flex my-1">
                <HelpTooltip
                    label={
                        pending
                            ? "Merging pull requests…"
                            : `Queue ${selected.verb} auto-merge for every pull request in this section`
                    }
                >
                    <span className="inline-flex">
                        <AlertDialogTrigger asChild>
                            <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                aria-busy={pending}
                                className={cn("h-7 gap-1.5 rounded-r-none px-2.5", MERGE_BUTTON_CLASS)}
                                aria-label={`${selected.buttonLabel} in ${sectionLabel}`}
                            >
                                {pending ? (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                    <GitMerge className="size-3.5" aria-hidden="true" />
                                )}
                                {pending ? "Merging…" : selected.buttonLabel}
                            </Button>
                        </AlertDialogTrigger>
                    </span>
                </HelpTooltip>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={busy}>
                        <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            className={cn("h-7 rounded-l-none border-l border-white/25 px-2", MERGE_BUTTON_CLASS)}
                            aria-label="Select auto-merge method"
                        >
                            <ChevronDown className="size-3.5" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                        {INBOX_AUTO_MERGE_METHODS.map((entry, index) => (
                            <div key={entry.value}>
                                {index > 0 ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem
                                    className="items-start gap-2 py-2"
                                    onSelect={() => setMethod(entry.value)}
                                >
                                    <Check
                                        className={cn(
                                            "mt-0.5 size-3.5 shrink-0",
                                            method === entry.value ? "opacity-100" : "opacity-0",
                                        )}
                                        aria-hidden="true"
                                    />
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                        <span className="font-medium">{entry.label}</span>
                                        <span className="text-xs text-muted-foreground">{entry.description}</span>
                                    </span>
                                </DropdownMenuItem>
                            </div>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {selected.buttonLabel} in {sectionLabel}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        Easy Review will queue {selected.verb} auto-merge for{" "}
                        {count === 1 ? "1 pull request" : `${count} pull requests`} in this section. Ready ones merge
                        now; the rest wait until checks and reviews pass.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className={MERGE_BUTTON_CLASS}
                        disabled={pending}
                        onClick={() => {
                            setPending(true);
                            void notifyAction(() => onAutoMergeAll(method), {
                                loading: "Merging pull requests…",
                                success: describeAutoMergeBatchResult,
                                error: "Could not auto-merge pull requests.",
                            }).finally(() => setPending(false));
                        }}
                    >
                        {selected.buttonLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function SelectableRow({
    pullRequest,
    selected,
    stackBadge,
    autoMergeQueued,
    onSelect,
}: {
    pullRequest: PullRequestSummary;
    selected: boolean;
    stackBadge: { position: number; total: number } | null;
    autoMergeQueued: boolean;
    onSelect: (key: string) => void;
}) {
    return (
        <div onMouseEnter={() => onSelect(pullRequest.key)} onFocusCapture={() => onSelect(pullRequest.key)}>
            <PullRequestRow
                pullRequest={pullRequest}
                selected={selected}
                stackBadge={stackBadge}
                autoMergeQueued={autoMergeQueued}
            />
        </div>
    );
}
