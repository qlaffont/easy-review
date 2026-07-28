import { useEffect, useMemo, useRef, useState } from "react";

import type { AppAction } from "#/lib/actions/catalog.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { useActionsBridge } from "#/components/actions/actions-provider.tsx";
import { PullRequestStateIcon } from "#/components/inbox/pull-request-row.tsx";
import { ChecksDot } from "#/components/pr/checks-dot.tsx";
import { ChordKeys } from "#/components/ui/chord-keys.tsx";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "#/components/ui/command.tsx";
import { TruncatedText } from "#/components/ui/truncated-text.tsx";
import { availableActions } from "#/lib/actions/catalog.ts";
import { useSessionState } from "#/lib/session/provider.tsx";

const GROUPS = ["Navigation", "Clipboard", "Inbox", "Pull request"] as const;
const MAX_PR_RESULTS = 25;
const MAX_INDEX_SHORTCUTS = 9;

type PaletteEntry = { kind: "action"; action: AppAction } | { kind: "pullRequest"; pullRequest: PullRequestSummary };

function isApplePlatform(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes("Mac");
}

function actionMatchesQuery(action: AppAction, query: string): boolean {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        return true;
    }
    const haystack = `${action.label} ${action.keywords?.join(" ") ?? ""} ${action.id}`.toLowerCase();
    return trimmed.split(/\s+/).every((token) => haystack.includes(token));
}

function pullRequestMatchesQuery(pullRequest: PullRequestSummary, query: string): boolean {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        return false;
    }
    const haystack = [
        pullRequest.title,
        pullRequest.repository,
        String(pullRequest.number),
        `#${pullRequest.number}`,
        `${pullRequest.repository}#${pullRequest.number}`,
        pullRequest.author,
        pullRequest.headRefName,
        pullRequest.baseRefName,
    ]
        .join(" ")
        .toLowerCase();
    return trimmed.split(/\s+/).every((token) => haystack.includes(token));
}

function pullRequestParams(repository: string, number: number): { owner: string; repo: string; number: string } {
    const [owner = "", repo = ""] = repository.split("/");
    return { owner, repo, number: String(number) };
}

function pullRequestPath(repository: string, number: number): string {
    const params = pullRequestParams(repository, number);
    return `/pr/${params.owner}/${params.repo}/${params.number}`;
}

/** Opens a path in a new tab and moves the user there. */
function openInNewTab(path: string) {
    const href = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    const tab = window.open(href, "_blank");
    if (tab) {
        tab.opener = null;
        tab.focus();
    }
}

function IndexShortcutKeys({ index }: { index: number }) {
    // Option/Alt avoids ⌘/Ctrl+number (browser tab switching). Bare digits would fight search.
    const mod = isApplePlatform() ? "⌥" : "Alt";
    return <ChordKeys keys={[mod, String(index)]} mode="combo" />;
}

export function CommandPalette() {
    const bridge = useActionsBridge();
    const pullRequests = useSessionState((state) => state.inbox.pullRequests);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const entriesRef = useRef<Array<PaletteEntry>>([]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((value) => !value);
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        if (!open) {
            setQuery("");
        }
    }, [open]);

    const context = bridge.buildContext();
    const actions = availableActions(context);

    const matchingActions = useMemo(
        () => actions.filter((action) => actionMatchesQuery(action, query)),
        [actions, query],
    );

    const matchingPullRequests = useMemo(() => {
        if (!query.trim() || matchingActions.length > 0) {
            return [];
        }
        return pullRequests
            .filter((pullRequest) => pullRequestMatchesQuery(pullRequest, query))
            .slice(0, MAX_PR_RESULTS);
    }, [matchingActions.length, pullRequests, query]);

    const visibleGroups = GROUPS.map((group) => ({
        group,
        items: matchingActions.filter((action) => action.group === group),
    })).filter((entry) => entry.items.length > 0);

    const flatEntries = useMemo(() => {
        const entries: Array<PaletteEntry> = [];
        for (const group of GROUPS) {
            for (const action of matchingActions) {
                if (action.group === group) {
                    entries.push({ kind: "action", action });
                }
            }
        }
        for (const pullRequest of matchingPullRequests) {
            entries.push({ kind: "pullRequest", pullRequest });
        }
        return entries;
    }, [matchingActions, matchingPullRequests]);

    entriesRef.current = flatEntries;

    const indexById = useMemo(() => {
        const map = new Map<string, number>();
        flatEntries.slice(0, MAX_INDEX_SHORTCUTS).forEach((entry, index) => {
            const id = entry.kind === "action" ? entry.action.id : entry.pullRequest.key;
            map.set(id, index + 1);
        });
        return map;
    }, [flatEntries]);

    function runEntry(entry: PaletteEntry) {
        setOpen(false);
        if (entry.kind === "action") {
            void entry.action.run(bridge.buildContext());
            return;
        }
        bridge.buildContext().openPullRequest(entry.pullRequest.repository, entry.pullRequest.number);
    }

    function openEntryInNewTab(entry: PaletteEntry) {
        if (entry.kind !== "pullRequest") {
            runEntry(entry);
            return;
        }
        setOpen(false);
        openInNewTab(pullRequestPath(entry.pullRequest.repository, entry.pullRequest.number));
    }

    const runEntryRef = useRef(runEntry);
    runEntryRef.current = runEntry;
    const openEntryInNewTabRef = useRef(openEntryInNewTab);
    openEntryInNewTabRef.current = openEntryInNewTab;

    useEffect(() => {
        if (!open) {
            return;
        }

        function selectedEntry(): PaletteEntry | undefined {
            const selected = document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
            const value = selected?.getAttribute("data-value");
            if (!value) {
                return undefined;
            }
            return entriesRef.current.find((entry) =>
                entry.kind === "action" ? entry.action.id === value : entry.pullRequest.key === value,
            );
        }

        function onKeyDown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                const entry = selectedEntry();
                if (entry?.kind === "pullRequest") {
                    event.preventDefault();
                    event.stopPropagation();
                    openEntryInNewTabRef.current(entry);
                }
                return;
            }

            // Option/Alt + 1–9. Use event.code — Option on Mac remaps event.key to symbols.
            if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
                return;
            }
            const match = /^Digit([1-9])$/.exec(event.code);
            if (!match) {
                return;
            }

            const entry = entriesRef.current[Number(match[1]) - 1];
            if (!entry) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            runEntryRef.current(entry);
        }

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [open]);

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title="Command palette"
            description="Run an Easy Review action or open a pull request"
            shouldFilter={false}
        >
            <CommandInput placeholder="Search commands or pull requests…" value={query} onValueChange={setQuery} />
            <CommandList>
                <CommandEmpty>
                    {query.trim() ? "No matching actions or pull requests." : "No actions available."}
                </CommandEmpty>
                {visibleGroups.map((entry, index) => (
                    <div key={entry.group}>
                        {index > 0 ? <CommandSeparator /> : null}
                        <CommandGroup heading={entry.group}>
                            {entry.items.map((action) => {
                                const shortcutIndex = indexById.get(action.id);

                                return (
                                    <CommandItem
                                        key={action.id}
                                        value={action.id}
                                        onSelect={() => runEntry({ kind: "action", action })}
                                    >
                                        <span className="min-w-0 flex-1 truncate">{action.label}</span>
                                        {shortcutIndex ? (
                                            <CommandShortcut className="shrink-0 tracking-normal">
                                                <IndexShortcutKeys index={shortcutIndex} />
                                            </CommandShortcut>
                                        ) : action.shortcut ? (
                                            <CommandShortcut className="shrink-0 tracking-normal">
                                                <ChordKeys keys={action.shortcut} />
                                            </CommandShortcut>
                                        ) : null}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </div>
                ))}
                {matchingPullRequests.length > 0 ? (
                    <>
                        {visibleGroups.length > 0 ? <CommandSeparator /> : null}
                        <CommandGroup heading="Pull requests">
                            {matchingPullRequests.map((pullRequest) => {
                                const shortcutIndex = indexById.get(pullRequest.key);
                                const href = pullRequestPath(pullRequest.repository, pullRequest.number);

                                return (
                                    <CommandItem
                                        key={pullRequest.key}
                                        value={pullRequest.key}
                                        className="items-center gap-2.5 py-2 [&_svg:not([class*='size-'])]:size-3.5"
                                        onMouseDown={(event) => {
                                            if (
                                                event.button === 1 ||
                                                ((event.metaKey || event.ctrlKey) && event.button === 0)
                                            ) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setOpen(false);
                                                openInNewTab(href);
                                            }
                                        }}
                                        onSelect={() => runEntry({ kind: "pullRequest", pullRequest })}
                                    >
                                        <ChecksDot state={pullRequest.checks} />
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <PullRequestStateIcon pullRequest={pullRequest} />
                                                <TruncatedText
                                                    text={pullRequest.title}
                                                    className="flex-1 font-medium text-foreground"
                                                />
                                            </span>
                                            <span className="flex min-w-0 items-center gap-1.5 pl-[1.375rem] text-xs text-muted-foreground">
                                                <span className="truncate">
                                                    {pullRequest.repository}#{pullRequest.number}
                                                </span>
                                                <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">
                                                    ·
                                                </span>
                                                <span className="truncate">{pullRequest.author}</span>
                                            </span>
                                        </span>
                                        {shortcutIndex ? (
                                            <CommandShortcut className="shrink-0 tracking-normal">
                                                <IndexShortcutKeys index={shortcutIndex} />
                                            </CommandShortcut>
                                        ) : null}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </>
                ) : null}
            </CommandList>
        </CommandDialog>
    );
}
