import { useSelector } from "@tanstack/react-store";
import {
    FileCode2,
    FileDiff,
    FileMinus2,
    FilePlus2,
    Maximize2,
    Minimize2,
    PanelLeftClose,
    PanelLeftOpen,
    RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PullRequestFile } from "#/lib/session/types.ts";

import { DiffSettingsMenu } from "#/components/pr/diff-settings-menu.tsx";
import { FileDiffViewer } from "#/components/pr/file-diff-viewer.tsx";
import { ReviewChangesMenu } from "#/components/pr/review-changes-menu.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { FileListLoadingSkeleton } from "#/components/ui/loading.tsx";
import { mentionCandidatesFromPullRequest } from "#/lib/composer-commands.ts";
import { readViewedPaths, useDiffPreferences, writeViewedPaths } from "#/lib/diff-preferences.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
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
    const threads = useSelector(session.state, () => session.getReviewThreads(repository, number));
    const viewer = useSelector(session.state, (state) => state.auth.viewer);
    const [selectedPath, setSelectedPath] = useState<string | null>(initialPath ?? null);
    const selectedDiff = useSelector(session.state, () =>
        selectedPath ? session.getFileDiff(repository, number, selectedPath) : null,
    );
    const [preferences, setPreferences] = useDiffPreferences();
    const headSha = page.detail?.headSha ?? "";
    const mentionUsers = useMemo(() => mentionCandidatesFromPullRequest(page.detail), [page.detail]);
    const [viewedPaths, setViewedPaths] = useState<Set<string>>(() => new Set());
    const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        void session.loadPullRequestFiles(repository, number);
        void session.loadReviewThreads(repository, number);
    }, [session, repository, number]);

    useEffect(() => {
        setViewedPaths(readViewedPaths(repository, number, headSha));
    }, [repository, number, headSha]);

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
    const threadsOnFile = selectedPath ? threads.items.filter((thread) => thread.path === selectedPath) : [];
    const fileCount = page.files.status === "ready" ? page.files.items.length : null;
    const viewedCount = page.files.items.filter((file) => viewedPaths.has(file.path)).length;
    const selectedFile = page.files.items.find((file) => file.path === selectedPath) ?? null;
    const diffPending =
        selectedDiff === null ||
        selectedDiff.status === "idle" ||
        selectedDiff.status === "loading" ||
        selectedDiff.refreshing === true;

    function setPathViewed(path: string, viewed: boolean) {
        setViewedPaths((current) => {
            const next = new Set(current);
            if (viewed) {
                next.add(path);
            } else {
                next.delete(path);
            }
            writeViewedPaths(repository, number, headSha, next);
            return next;
        });

        if (viewed) {
            setCollapsedPaths((current) => new Set(current).add(path));
            const files = page.files.items;
            const index = files.findIndex((file) => file.path === path);
            const isAlreadyViewed = (candidate: string) => candidate === path || viewedPaths.has(candidate);
            const nextFile =
                files.slice(index + 1).find((file) => !isAlreadyViewed(file.path)) ??
                files.slice(0, Math.max(0, index)).find((file) => !isAlreadyViewed(file.path));
            if (nextFile) {
                setSelectedPath(nextFile.path);
            }
        }
    }

    return (
        <div className={cn(preferences.fullWidth && "relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 px-4")}>
            <section id="review" className="flex min-h-0 scroll-mt-20 flex-col overflow-hidden rounded-lg border">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                        <h2 className="text-sm font-medium">
                            Files changed
                            {fileCount !== null ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                                    {fileCount}
                                </span>
                            ) : null}
                        </h2>
                        {fileCount !== null && fileCount > 0 ? (
                            <ViewedProgress viewed={viewedCount} total={fileCount} />
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <HelpTooltip
                            label={
                                preferences.fullWidth
                                    ? "Constrain Files changed to the page width"
                                    : "Expand Files changed to full viewport width"
                            }
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                aria-pressed={preferences.fullWidth}
                                aria-label={preferences.fullWidth ? "Exit full width" : "Full width"}
                                onClick={() => setPreferences({ fullWidth: !preferences.fullWidth })}
                            >
                                {preferences.fullWidth ? (
                                    <Minimize2 className="size-3.5" aria-hidden="true" />
                                ) : (
                                    <Maximize2 className="size-3.5" aria-hidden="true" />
                                )}
                                <span className="hidden sm:inline">
                                    {preferences.fullWidth ? "Exit full width" : "Full width"}
                                </span>
                            </Button>
                        </HelpTooltip>
                        <HelpTooltip
                            label={preferences.showFileList ? "Hide file list for more review space" : "Show file list"}
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                aria-pressed={preferences.showFileList}
                                aria-label={preferences.showFileList ? "Hide file list" : "Show file list"}
                                onClick={() => setPreferences({ showFileList: !preferences.showFileList })}
                            >
                                <span className="relative size-3.5">
                                    <PanelLeftClose
                                        className={cn(
                                            "absolute inset-0 size-3.5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                                            preferences.showFileList ? "scale-100 opacity-100" : "scale-75 opacity-0",
                                        )}
                                        aria-hidden="true"
                                    />
                                    <PanelLeftOpen
                                        className={cn(
                                            "absolute inset-0 size-3.5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                                            preferences.showFileList ? "scale-75 opacity-0" : "scale-100 opacity-100",
                                        )}
                                        aria-hidden="true"
                                    />
                                </span>
                                <span className="hidden sm:inline">
                                    {preferences.showFileList ? "Hide files" : "Files"}
                                </span>
                            </Button>
                        </HelpTooltip>
                        <HelpTooltip label="Reload the changed-files list from GitHub">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={page.files.refreshing}
                                onClick={() =>
                                    void notifyAction(() => session.refreshPullRequestFiles(repository, number), {
                                        loading: "Refreshing files…",
                                        success: "File list refreshed",
                                        error: "Could not refresh files.",
                                    })
                                }
                            >
                                <RefreshCw className={cn("size-3.5", page.files.refreshing && "animate-spin")} />
                                Refresh
                            </Button>
                        </HelpTooltip>
                        <ReviewChangesMenu repository={repository} number={number} />
                        <DiffSettingsMenu preferences={preferences} onChange={setPreferences} />
                    </div>
                </header>

                {page.files.error ? (
                    <p className="border-b px-3 py-2 text-sm text-destructive">{page.files.error.message}</p>
                ) : null}

                <div className="flex min-h-0 h-[min(70svh,52rem)] flex-col md:flex-row">
                    <aside
                        className={cn(
                            "min-h-0 shrink-0 overflow-hidden border-border",
                            "max-md:border-b max-md:transition-[max-height,opacity,border-color] max-md:duration-300 max-md:ease-[cubic-bezier(0.32,0.72,0,1)]",
                            "md:border-r md:transition-[width,opacity,border-color] md:duration-300 md:ease-[cubic-bezier(0.32,0.72,0,1)]",
                            "motion-reduce:transition-none",
                            preferences.showFileList
                                ? "max-md:max-h-48 max-md:opacity-100 md:w-64 md:opacity-100"
                                : "max-md:max-h-0 max-md:border-b-transparent max-md:opacity-0 md:w-0 md:border-r-transparent md:opacity-0",
                        )}
                        aria-hidden={!preferences.showFileList}
                        inert={!preferences.showFileList ? true : undefined}
                    >
                        <div className="h-full max-md:max-h-48 md:w-64">
                            <FileList
                                files={page.files.items}
                                status={page.files.status}
                                selectedPath={selectedPath}
                                viewedPaths={viewedPaths}
                                pendingPaths={new Set(draft.comments.map((comment) => comment.path))}
                                onSelect={setSelectedPath}
                            />
                        </div>
                    </aside>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2 transition-[padding] duration-300 ease-out motion-reduce:transition-none">
                        {selectedPath ? (
                            <FileDiffViewer
                                path={selectedPath}
                                file={selectedFile}
                                diff={selectedDiff?.diff ?? null}
                                isLoading={diffPending}
                                error={selectedDiff?.error?.message ?? null}
                                pendingComments={pendingOnFile}
                                threads={threadsOnFile}
                                viewerLogin={viewer?.login ?? null}
                                viewerAvatarUrl={viewer?.avatarUrl ?? null}
                                showInlineComments={!preferences.minimizeComments}
                                disabled={draft.stale}
                                repository={repository}
                                number={number}
                                canApplySuggestions={page.detail?.state === "open"}
                                mentionUsers={mentionUsers}
                                layout={preferences.layout}
                                hideWhitespace={preferences.hideWhitespace}
                                compactLineHeight={preferences.compactLineHeight}
                                viewed={viewedPaths.has(selectedPath)}
                                collapsed={collapsedPaths.has(selectedPath)}
                                onCollapsedChange={(collapsed) => {
                                    setCollapsedPaths((current) => {
                                        const next = new Set(current);
                                        if (collapsed) {
                                            next.add(selectedPath);
                                        } else {
                                            next.delete(selectedPath);
                                        }
                                        return next;
                                    });
                                }}
                                onViewedChange={(viewed) => setPathViewed(selectedPath, viewed)}
                                previewBaseUrl={
                                    page.detail
                                        ? `https://github.com/${page.detail.repository}/blob/${page.detail.headRefName}/`
                                        : `https://github.com/${repository}/`
                                }
                                onLoadAnyway={() =>
                                    void notifyAction(
                                        () => session.loadFileDiff(repository, number, selectedPath, { force: true }),
                                        {
                                            loading: "Loading file…",
                                            success: "File loaded",
                                            error: "Could not load the file.",
                                        },
                                    )
                                }
                                onAddComment={async (target, body) => {
                                    await notifyAction(
                                        () =>
                                            session.addPendingComment(repository, number, {
                                                path: target.path,
                                                line: target.line,
                                                side: target.side,
                                                body,
                                            }),
                                        {
                                            loading: "Adding comment to review…",
                                            success: "Comment staged for review",
                                            error: "Could not stage the comment.",
                                        },
                                    );
                                }}
                                onAddSingleComment={async (target, body) => {
                                    await notifyAction(
                                        () =>
                                            session.addSingleLineComment(repository, number, {
                                                path: target.path,
                                                line: target.line,
                                                side: target.side,
                                                body,
                                            }),
                                        {
                                            loading: "Posting comment…",
                                            success: "Comment posted",
                                            error: "Could not post the comment.",
                                        },
                                    );
                                }}
                                onRemovePending={async (commentId) => {
                                    await session.removePendingComment(repository, number, commentId);
                                }}
                                onReplyToThread={async (threadId, body) => {
                                    await session.replyToReviewThread(repository, number, threadId, body);
                                }}
                            />
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
        </div>
    );
}

function ViewedProgress({ viewed, total }: { viewed: number; total: number }) {
    const progress = total === 0 ? 0 : viewed / total;
    const radius = 7;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - progress);

    return (
        <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-label={`${viewed} of ${total} viewed`}
        >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
                <circle cx="9" cy="9" r={radius} fill="none" className="stroke-muted-foreground/25" strokeWidth="2" />
                <circle
                    cx="9"
                    cy="9"
                    r={radius}
                    fill="none"
                    className="stroke-emerald-600 dark:stroke-emerald-400"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform="rotate(-90 9 9)"
                />
            </svg>
            <span>
                <span className="font-medium text-foreground tabular-nums">
                    {viewed} / {total}
                </span>{" "}
                viewed
            </span>
        </div>
    );
}

function FileList({
    files,
    status,
    selectedPath,
    viewedPaths,
    pendingPaths,
    onSelect,
}: {
    files: Array<PullRequestFile>;
    status: string;
    selectedPath: string | null;
    viewedPaths: Set<string>;
    pendingPaths: Set<string>;
    onSelect: (path: string) => void;
}) {
    if (status === "loading" || status === "idle") {
        return <FileListLoadingSkeleton />;
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
                                viewedPaths.has(file.path) && "opacity-60",
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
                                    {viewedPaths.has(file.path) ? <span>viewed</span> : null}
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
