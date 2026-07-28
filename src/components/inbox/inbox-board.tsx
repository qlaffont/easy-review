import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { ChevronRight, FolderGit2, Keyboard, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import type { InboxSection, InboxSectionId, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { emptySectionRow, PullRequestRow } from "#/components/inbox/pull-request-row.tsx";
import { visualForSection } from "#/components/inbox/section-visuals.ts";
import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { InboxLoadingSkeleton } from "#/components/ui/loading.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

/** How many pull requests each expanded section shows before “Load more…”. */
const INBOX_SECTION_PAGE_SIZE = 10;

export function InboxBoard() {
    const session = useSession();
    const navigate = useNavigate();
    const openRepoPicker = useOpenRepoPicker();
    const inbox = useSessionState((state) => state.inbox);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    const sections = useSelector(session.state, () => session.getInboxSections());
    const sectionLayout = useSelector(session.state, () => session.getSectionLayout());
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [visibleCountBySection, setVisibleCountBySection] = useState<Partial<Record<InboxSectionId, number>>>({});

    function visibleCountFor(id: InboxSectionId): number {
        return visibleCountBySection[id] ?? INBOX_SECTION_PAGE_SIZE;
    }

    const flatRows = sections
        .filter((section) => inbox.expandedSections.includes(section.id))
        .flatMap((section) => section.pullRequests.slice(0, visibleCountFor(section.id)));
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

        const [owner = "", repo = ""] = selected.repository.split("/");
        void navigate({
            to: "/pr/$owner/$repo/$number",
            params: { owner, repo, number: String(selected.number) },
        });
    });

    useEffect(() => {
        void session.loadInbox();
    }, [session, selectedCount, inbox.stale]);

    useEffect(() => {
        function revalidateWhenVisible() {
            if (document.visibilityState === "visible") {
                void session.revalidateInbox();
            }
        }

        document.addEventListener("visibilitychange", revalidateWhenVisible);
        window.addEventListener("focus", revalidateWhenVisible);

        return () => {
            document.removeEventListener("visibilitychange", revalidateWhenVisible);
            window.removeEventListener("focus", revalidateWhenVisible);
        };
    }, [session]);

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
                        {inbox.refreshing ? (
                            <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                                <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                                Syncing with GitHub…
                            </span>
                        ) : inbox.lastLoadedAt ? (
                            <span className="inline-flex items-center gap-1">
                                Updated <RelativeTime iso={inbox.lastLoadedAt} />
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
                            disabled={inbox.refreshing}
                            onClick={() =>
                                void notifyAction(() => session.refreshInbox(), {
                                    loading: "Refreshing inbox…",
                                    success: "Inbox refreshed",
                                    error: "Could not refresh the inbox.",
                                })
                            }
                        >
                            <RefreshCw className={inbox.refreshing ? "animate-spin" : undefined} />
                            Refresh
                        </Button>
                    </div>
                </div>
            </div>

            {inbox.error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {inbox.error.message}
                </p>
            ) : null}

            {inbox.status === "loading" ? (
                <InboxLoadingSkeleton />
            ) : (
                <div className="flex flex-col gap-2">
                    {sections.map((section) => {
                        const layoutEntry = sectionLayout.find((entry) => entry.id === section.id);
                        const isExpanded = inbox.expandedSections.includes(section.id);
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
                                onLoadMore={() => {
                                    setVisibleCountBySection((current) => ({
                                        ...current,
                                        [section.id]: visibleCount + INBOX_SECTION_PAGE_SIZE,
                                    }));
                                }}
                                onSelect={setSelectedKey}
                            />
                        );
                    })}
                </div>
            )}
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
    visibleCount,
    onToggle,
    onLoadMore,
    onSelect,
}: {
    section: InboxSection;
    color?: SectionColorId;
    customColor?: string | null;
    icon?: SectionIconId;
    selectedKey: string | null;
    isExpanded: boolean;
    visibleCount: number;
    onToggle: () => void;
    onLoadMore: () => void;
    onSelect: (key: string) => void;
}) {
    const visual = visualForSection(section.id, { color, customColor, icon });
    const Icon = visual.icon;
    const count = section.pullRequests.length;
    const visiblePullRequests = section.pullRequests.slice(0, visibleCount);
    const remaining = count - visiblePullRequests.length;

    return (
        <section
            className={cn("overflow-hidden rounded-lg border border-l-[3px]", visual.accentClass)}
            style={visual.tones?.accent}
        >
            <h2>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={isExpanded}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors",
                        visual.headerClass,
                    )}
                    style={visual.tones?.header}
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
            </h2>

            {isExpanded ? (
                section.pullRequests.length === 0 ? (
                    emptySectionRow
                ) : (
                    <div className="flex flex-col">
                        {visiblePullRequests.map((pullRequest) => (
                            <SelectableRow
                                key={pullRequest.key}
                                pullRequest={pullRequest}
                                selected={pullRequest.key === selectedKey}
                                onSelect={onSelect}
                            />
                        ))}
                        {remaining > 0 ? (
                            <button
                                type="button"
                                className="cursor-pointer border-t px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                onClick={onLoadMore}
                            >
                                Load more… ({remaining} remaining)
                            </button>
                        ) : null}
                    </div>
                )
            ) : null}
        </section>
    );
}

function SelectableRow({
    pullRequest,
    selected,
    onSelect,
}: {
    pullRequest: PullRequestSummary;
    selected: boolean;
    onSelect: (key: string) => void;
}) {
    return (
        <div onMouseEnter={() => onSelect(pullRequest.key)} onFocusCapture={() => onSelect(pullRequest.key)}>
            <PullRequestRow pullRequest={pullRequest} selected={selected} />
        </div>
    );
}
