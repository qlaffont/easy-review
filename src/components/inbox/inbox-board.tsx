import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import type { InboxSection } from "#/lib/session/inbox-sections.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { targetFromSummary, useSetActionTarget } from "#/components/actions/actions-provider.tsx";
import { emptySectionRow, PullRequestRow } from "#/components/inbox/pull-request-row.tsx";
import { SectionLayoutEditor } from "#/components/inbox/section-layout-editor.tsx";
import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatRelativeTime } from "#/lib/format.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
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
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
                <p className="text-sm text-muted-foreground">
                    Pick the repositories you triage and their pull requests will show up here.
                </p>
                <Button onClick={openRepoPicker}>Choose repositories</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    {inbox.refreshing
                        ? "Syncing with GitHub…"
                        : inbox.lastLoadedAt
                          ? `Updated ${formatRelativeTime(inbox.lastLoadedAt)}`
                          : "Not synced yet"}
                    <span className="ml-2 hidden sm:inline">· j/k select · Enter open · ⌘K commands</span>
                </p>
                <div className="flex items-center gap-2">
                    <SectionLayoutEditor />
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={inbox.refreshing}
                        onClick={() => void session.refreshInbox()}
                    >
                        <RefreshCw className={inbox.refreshing ? "animate-spin" : undefined} />
                        Refresh
                    </Button>
                </div>
            </div>

            {inbox.error ? <p className="text-sm text-destructive">{inbox.error.message}</p> : null}

            {inbox.status === "loading" ? (
                <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                    Loading pull requests…
                </p>
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
    return (
        <section className="overflow-hidden rounded-lg border">
            <h2>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                >
                    <ChevronRight
                        aria-hidden="true"
                        className={cn("size-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")}
                    />
                    {section.label}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {section.pullRequests.length}
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
