import { useSelector } from "@tanstack/react-store";
import { FileCode2, FileDiff, FileMinus2, FilePlus2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { PullRequestFile } from "#/lib/session/types.ts";

import { FileDiffViewer } from "#/components/pr/file-diff-viewer.tsx";
import { ReviewThreadsPanel } from "#/components/pr/review-threads.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

export function ReviewChanges({
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
    const draft = useSelector(session.state, () => session.getReviewDraft(repository, number));
    const [selectedPath, setSelectedPath] = useState<string | null>(initialPath ?? null);
    const selectedDiff = useSelector(session.state, () =>
        selectedPath ? session.getFileDiff(repository, number, selectedPath) : null,
    );

    useEffect(() => {
        void session.loadPullRequestFiles(repository, number);
    }, [session, repository, number]);

    useEffect(() => {
        if (initialPath) {
            setSelectedPath(initialPath);
            return;
        }

        if (!selectedPath && page.files.items[0]) {
            setSelectedPath(page.files.items[0].path);
        }
    }, [page.files.items, selectedPath, initialPath]);

    // Re-run when the file list refreshes — that wipe clears `diffs`, and selectedPath alone
    // would not change, so without `filesEpoch` the pane would stay empty.
    const filesEpoch = page.files.lastLoadedAt;

    useEffect(() => {
        if (selectedPath) {
            void session.loadFileDiff(repository, number, selectedPath);
        }
    }, [session, repository, number, selectedPath, filesEpoch]);

    const pendingOnFile = draft.comments.filter((comment) => comment.path === selectedPath);
    const fileCount = page.files.status === "ready" ? page.files.items.length : null;
    const diffPending =
        selectedDiff === null ||
        selectedDiff.status === "idle" ||
        selectedDiff.status === "loading" ||
        selectedDiff.refreshing === true;

    return (
        <section id="review" className="flex min-h-0 flex-col overflow-hidden rounded-lg border">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
                <h2 className="text-sm font-medium">
                    Files changed
                    {fileCount !== null ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{fileCount}</span>
                    ) : null}
                </h2>
                <HelpTooltip label="Reload the changed-files list from GitHub">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={page.files.refreshing}
                        onClick={() => void session.refreshPullRequestFiles(repository, number)}
                    >
                        <RefreshCw className={cn("size-3.5", page.files.refreshing && "animate-spin")} />
                        Refresh
                    </Button>
                </HelpTooltip>
            </header>

            {page.files.error ? (
                <p className="border-b px-3 py-2 text-sm text-destructive">{page.files.error.message}</p>
            ) : null}

            <div className="grid min-h-0 h-[min(70svh,52rem)] grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)]">
                <FileList
                    files={page.files.items}
                    status={page.files.status}
                    selectedPath={selectedPath}
                    pendingPaths={new Set(draft.comments.map((comment) => comment.path))}
                    onSelect={setSelectedPath}
                />
                <div className="flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l">
                    {selectedPath ? (
                        <>
                            <h3 className="shrink-0 truncate border-b px-3 py-2 font-mono text-xs text-muted-foreground">
                                {selectedPath}
                            </h3>
                            <FileDiffViewer
                                path={selectedPath}
                                diff={selectedDiff?.diff ?? null}
                                isLoading={diffPending}
                                error={selectedDiff?.error?.message ?? null}
                                pendingComments={pendingOnFile}
                                disabled={draft.stale}
                                previewBaseUrl={
                                    page.detail
                                        ? `https://github.com/${page.detail.repository}/blob/${page.detail.headRefName}/`
                                        : `https://github.com/${repository}/`
                                }
                                onLoadAnyway={() =>
                                    void session.loadFileDiff(repository, number, selectedPath, { force: true })
                                }
                                onAddComment={(target, body) =>
                                    session
                                        .addPendingComment(repository, number, {
                                            path: target.path,
                                            line: target.line,
                                            side: target.side,
                                            body,
                                        })
                                        .then(() => undefined)
                                }
                            />
                            <ReviewThreadsPanel repository={repository} number={number} path={selectedPath} />
                        </>
                    ) : (
                        <p className="p-6 text-sm text-muted-foreground">Select a file to review its diff.</p>
                    )}
                </div>
            </div>

            {draft.comments.length > 0 || draft.stale ? (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs">
                    <p className="text-muted-foreground">
                        {draft.stale
                            ? "Draft is stale — open Review changes to discard or refresh."
                            : `${draft.comments.length} pending comment${draft.comments.length === 1 ? "" : "s"} — submit from Review changes above.`}
                    </p>
                </div>
            ) : null}
        </section>
    );
}

function FileList({
    files,
    status,
    selectedPath,
    pendingPaths,
    onSelect,
}: {
    files: Array<PullRequestFile>;
    status: string;
    selectedPath: string | null;
    pendingPaths: Set<string>;
    onSelect: (path: string) => void;
}) {
    if (status === "loading" || status === "idle") {
        return <p className="p-3 text-sm text-muted-foreground">Loading files…</p>;
    }

    if (files.length === 0) {
        return <p className="p-3 text-sm text-muted-foreground">No files changed.</p>;
    }

    return (
        <nav aria-label="Changed files" className="min-h-0 overflow-y-auto">
            <ul className="flex flex-col py-1">
                {files.map((file) => (
                    <li key={file.path}>
                        <button
                            type="button"
                            onClick={() => onSelect(file.path)}
                            className={cn(
                                "flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
                                selectedPath === file.path && "bg-accent",
                            )}
                        >
                            <FileStatusIcon status={file.status} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono">
                                    {file.path}
                                    {pendingPaths.has(file.path) ? (
                                        <span className="ml-1 text-amber-600">•</span>
                                    ) : null}
                                </span>
                                <span className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground tabular-nums">
                                    <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                                    <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                                    {file.stub ? <span className="uppercase tracking-wide">{file.stub}</span> : null}
                                </span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

function FileStatusIcon({ status }: { status: PullRequestFile["status"] }) {
    const className = "mt-0.5 size-3.5 shrink-0 text-muted-foreground";

    switch (status) {
        case "added":
            return <FilePlus2 className={cn(className, "text-emerald-600")} aria-label="Added" />;
        case "removed":
            return <FileMinus2 className={cn(className, "text-red-600")} aria-label="Removed" />;
        case "renamed":
            return <FileDiff className={className} aria-label="Renamed" />;
        default:
            return <FileCode2 className={className} aria-label="Modified" />;
    }
}
