import { Lock, RefreshCw } from "lucide-react";
import { createContext, use, useDeferredValue, useEffect, useMemo, useState } from "react";

import type { Repository } from "#/lib/session/types.ts";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "#/components/ui/dialog.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Input } from "#/components/ui/input.tsx";
import { RepoPickerLoadingSkeleton } from "#/components/ui/loading.tsx";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifyAction, notifySuccess } from "#/lib/toast.ts";

const RepoPickerContext = createContext<(() => void) | null>(null);

/** Lets the header and the empty Inbox open the same picker. */
export function useOpenRepoPicker(): () => void {
    const open = use(RepoPickerContext);

    if (!open) {
        throw new Error("useOpenRepoPicker must be used inside a RepoPickerProvider.");
    }

    return open;
}

export function RepoPickerProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const open = useMemo(() => () => setIsOpen(true), []);

    return (
        <RepoPickerContext value={open}>
            {children}
            <RepoPickerDialog open={isOpen} onOpenChange={setIsOpen} />
        </RepoPickerContext>
    );
}

export function RepoPickerTrigger() {
    const open = useOpenRepoPicker();
    const selectedCount = useSessionState((state) => state.repos.selected.length);

    return (
        <Button variant="outline" size="sm" onClick={open}>
            {selectedCount === 0 ? "Choose repositories" : `${selectedCount} repos selected`}
        </Button>
    );
}

function matches(repository: Repository, query: string): boolean {
    return repository.nameWithOwner.toLowerCase().includes(query);
}

function RepoPickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const session = useSession();
    const repos = useSessionState((state) => state.repos);
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search);

    useEffect(() => {
        if (open) {
            void session.loadRepositories();
        }
    }, [open, session]);

    const selected = useMemo(() => new Set(repos.selected), [repos.selected]);
    const visible = useMemo(() => {
        const query = deferredSearch.trim().toLowerCase();
        return query ? repos.available.filter((repository) => matches(repository, query)) : repos.available;
    }, [repos.available, deferredSearch]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[80svh] flex-col gap-4 sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Repositories</DialogTitle>
                    <DialogDescription>
                        Only the repositories you pick here are queried for your Inbox.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-2">
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Filter by owner or name"
                        aria-label="Filter repositories"
                    />
                    <HelpTooltip label="Refresh the list from GitHub">
                        <Button
                            variant="outline"
                            size="icon"
                            aria-label="Refresh the list from GitHub"
                            disabled={repos.refreshing}
                            onClick={() =>
                                void notifyAction(() => session.refreshRepositories(), {
                                    loading: "Refreshing repositories…",
                                    success: "Repositories refreshed",
                                    error: "Could not refresh repositories.",
                                })
                            }
                        >
                            <RefreshCw className={repos.refreshing ? "animate-spin" : undefined} />
                        </Button>
                    </HelpTooltip>
                </div>

                {repos.error ? <p className="text-sm text-destructive">{repos.error.message}</p> : null}

                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                    {repos.status === "loading" ? (
                        <RepoPickerLoadingSkeleton />
                    ) : visible.length === 0 ? (
                        <div className="flex flex-col gap-2 py-8 text-center text-sm text-muted-foreground">
                            <p>
                                {repos.available.length === 0
                                    ? "This session cannot see any repository."
                                    : "No repository matches that filter."}
                            </p>
                            {repos.available.length === 0 ? (
                                <p>
                                    Missing an org repo? Grant that organization access to the OAuth app (or install the
                                    GitHub App on the org), then sign in again and refresh.
                                </p>
                            ) : null}
                        </div>
                    ) : (
                        <ul className="flex flex-col">
                            {visible.map((repository) => (
                                <li key={repository.nameWithOwner}>
                                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent">
                                        <Checkbox
                                            checked={selected.has(repository.nameWithOwner)}
                                            onCheckedChange={(checked) => {
                                                const selectedNext = checked === true;
                                                void session
                                                    .toggleRepository(repository.nameWithOwner, selectedNext)
                                                    .then(() =>
                                                        notifySuccess(
                                                            selectedNext
                                                                ? `Added ${repository.nameWithOwner}`
                                                                : `Removed ${repository.nameWithOwner}`,
                                                        ),
                                                    );
                                            }}
                                        />
                                        <span className="truncate">{repository.nameWithOwner}</span>
                                        {repository.isPrivate ? (
                                            <Lock className="size-3 text-muted-foreground" aria-label="Private" />
                                        ) : null}
                                        {repository.isArchived ? (
                                            <Badge variant="secondary" className="text-[10px]">
                                                Archived
                                            </Badge>
                                        ) : null}
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    <span className="text-sm text-muted-foreground">
                        {repos.selected.length} selected of {repos.available.length} visible
                    </span>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
