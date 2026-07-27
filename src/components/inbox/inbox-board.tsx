import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { ChevronRight, FolderGit2, Keyboard, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import type { InboxSection } from "#/lib/session/inbox-sections.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { emptySectionRow, PullRequestRow } from "#/components/inbox/pull-request-row.tsx";
import { SectionLayoutEditor } from "#/components/inbox/section-layout-editor.tsx";
import { SECTION_VISUALS } from "#/components/inbox/section-visuals.ts";
import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { InboxLoadingSkeleton } from "#/components/ui/loading.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function InboxBoard() {
    const session = useSession();
    const navigate = useNavigate();
    const openRepoPicker = useOpenRepoPicker();
    const inbox = useSessionState((state) => state.inbox);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    const sections = useSelector(session.state, () => session.getInboxSections());
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const flatRows = sections
        .filter((section) => inbox.expandedSections.includes(section.id))
        .flatMap((section) => section.pullRequests);
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

            if (event.key === "j" || event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
                return;
            }

            if (event.key === "k" || event.key === "ArrowUp") {
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
                        j/k select · Enter open · ⌘K commands
                    </span>
                </p>
                <div className="flex items-center gap-2">
                    <SectionLayoutEditor />
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

            {inbox.error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {inbox.error.message}
                </p>
            ) : null}

            {inbox.status === "loading" ? (
                <InboxLoadingSkeleton />
            ) : (
                <div className="flex flex-col gap-2">
                    {sections.map((section) => (
                        <InboxSectionPanel
                            key={section.id}
                            section={section}
                            selectedKey={selected?.key ?? null}
                            isExpanded={inbox.expandedSections.includes(section.id)}
                            onToggle={() => void session.toggleSection(section.id)}
                            onSelect={setSelectedKey}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function InboxSectionPanel({
    section,
    selectedKey,
    isExpanded,
    onToggle,
    onSelect,
}: {
    section: InboxSection;
    selectedKey: string | null;
    isExpanded: boolean;
    onToggle: () => void;
    onSelect: (key: string) => void;
}) {
    const visual = SECTION_VISUALS[section.id];
    const Icon = visual.icon;
    const count = section.pullRequests.length;

    return (
        <section className={cn("overflow-hidden rounded-lg border border-l-[3px]", visual.accentClass)}>
            <h2>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={isExpanded}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors",
                        visual.headerClass,
                    )}
                >
                    <ChevronRight
                        aria-hidden="true"
                        className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isExpanded && "rotate-90",
                        )}
                    />
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", visual.chipClass)}>
                        <Icon className={cn("size-3.5", visual.iconClass)} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 truncate">{section.label}</span>
                    <span
                        className={cn(
                            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                            count > 0 ? visual.countClass : "bg-muted/80 text-muted-foreground",
                        )}
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
                        {section.pullRequests.map((pullRequest) => (
                            <SelectableRow
                                key={pullRequest.key}
                                pullRequest={pullRequest}
                                selected={pullRequest.key === selectedKey}
                                onSelect={onSelect}
                            />
                        ))}
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
