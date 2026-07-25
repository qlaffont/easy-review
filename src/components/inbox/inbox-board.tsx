import { useSelector } from "@tanstack/react-store";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import type { InboxSection } from "#/lib/session/inbox-sections.ts";

import { emptySectionRow, PullRequestRow } from "#/components/inbox/pull-request-row.tsx";
import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatRelativeTime } from "#/lib/format.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

export function InboxBoard() {
    const session = useSession();
    const openRepoPicker = useOpenRepoPicker();
    const inbox = useSessionState((state) => state.inbox);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    // Sections are derived from the whole store, so recompute whenever any of it changes.
    const sections = useSelector(session.state, () => session.getInboxSections());

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
                </p>
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
                            isExpanded={inbox.expandedSections.includes(section.id)}
                            onToggle={() => void session.toggleSection(section.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function InboxSectionPanel({
    section,
    isExpanded,
    onToggle,
}: {
    section: InboxSection;
    isExpanded: boolean;
    onToggle: () => void;
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
                            <PullRequestRow key={pullRequest.key} pullRequest={pullRequest} />
                        ))}
                    </div>
                )
            ) : null}
        </section>
    );
}
