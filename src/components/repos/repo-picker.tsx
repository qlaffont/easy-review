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
import { useRepositoriesQuery } from "#/lib/query/repositories.ts";
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
    const { available, isLoading, isFetching, refresh } = useRepositoriesQuery();
    const selectedRepos = useSessionState((state) => state.repos.selected);
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search);

    useEffect(() => {
        if (open) {
            void session.loadRepositories();
        }
    }, [open, session]);

    const selected = useMemo(() => new Set(selectedRepos), [selectedRepos]);
    const visible = useMemo(() => {
        const query = deferredSearch.trim().toLowerCase();
        return query ? available.filter((repository) => matches(repository, query)) : available;
    }, [available, deferredSearch]);

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
                            disabled={isFetching}
                            onClick={() =>
                                void notifyAction(() => refresh(), {
                                    loading: "Refreshing repositories…",
                                    success: "Repositories refreshed",
                                    error: "Could not refresh repositories.",
                                })
                            }
                        >
                            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
                        </Button>
                    </HelpTooltip>
                </div>

                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                    {isLoading && available.length === 0 ? (
                        <RepoPickerLoadingSkeleton />
                    ) : visible.length === 0 ? (
                        <div className="flex flex-col gap-2 py-8 text-center text-sm text-muted-foreground">
                            <p>
                                {available.length === 0
                                    ? "This session cannot see any repository."
                                    : "No repository matches that filter."}
                            </p>
                            {available.length === 0 ? (
                                <p>
                                    Missing an org repo? Install the GitHub App on that organization (Any account
                                    installability, select the repos, org approval if required), then sign in again and
                                    refresh. Details: <code className="text-xs">docs/github-setup.md</code>.
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
                        {selectedRepos.length} selected of {available.length} visible
                    </span>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
