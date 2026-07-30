import { useSelector } from "@tanstack/react-store";
import {
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    FileCode2,
    FileDiff,
    FileMinus2,
    FilePlus2,
    Folder,
    FolderOpen,
    List,
    ListTree,
    Maximize2,
    Minimize2,
    PanelLeftClose,
    PanelLeftOpen,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from "react";

import type { FileDiff as FileDiffPayload, PullRequestFile } from "#/lib/session/types.ts";

import { CommitRangePicker, type CommitRangeValue } from "#/components/pr/commit-range-picker.tsx";
import { DiffSettingsMenu } from "#/components/pr/diff-settings-menu.tsx";
import { ReviewChangesMenu } from "#/components/pr/review-changes-menu.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Input } from "#/components/ui/input.tsx";
import { DiffLoadingSkeleton, FileListLoadingSkeleton } from "#/components/ui/loading.tsx";
import { mentionCandidatesFromPullRequest } from "#/lib/composer-commands.ts";
import {
    clampFileListWidth,
    FILE_LIST_WIDTH_MAX,
    FILE_LIST_WIDTH_MIN,
    fileViewState,
    readViewedFileMarks,
    useDiffPreferences,
    writeViewedFileMarks,
    type FileViewState,
    type ViewedFileMarks,
} from "#/lib/diff-preferences.ts";
import {
    buildFileTree,
    defaultExpandedDirPaths,
    filePathsInDisplayOrder,
    type FileTreeDirNode,
    type FileTreeNode,
} from "#/lib/file-tree.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const FileDiffViewer = lazy(() =>
    import("#/components/pr/file-diff-viewer.tsx").then((module) => ({ default: module.FileDiffViewer })),
);

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
    const commits = useSelector(session.state, () => session.getPullRequestCommits(repository, number));
    const viewer = useSelector(session.state, (state) => state.auth.viewer);
    const [selectedPath, setSelectedPath] = useState<string | null>(initialPath ?? null);
    const [browsingViewedFile, setBrowsingViewedFile] = useState(Boolean(initialPath));
    const allViewedRef = useRef(false);
    const selectedDiff = useSelector(session.state, () =>
        selectedPath ? session.getFileDiff(repository, number, selectedPath) : null,
    );
    const [preferences, setPreferences] = useDiffPreferences();
    const headSha = page.detail?.headSha ?? "";
    const baseSha = page.detail?.baseSha ?? "";
    const mentionUsers = useMemo(() => mentionCandidatesFromPullRequest(page.detail), [page.detail]);
    const [viewedMarks, setViewedMarks] = useState<ViewedFileMarks>(() => ({}));
    const [resizingFileList, setResizingFileList] = useState(false);
    const fileListWidth = preferences.fileListWidth;
    const [commitRange, setCommitRange] = useState<CommitRangeValue>({ mode: "all" });
    const [rangeFiles, setRangeFiles] = useState<Array<PullRequestFile> | null>(null);
    const [rangeFilesStatus, setRangeFilesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [rangeFilesError, setRangeFilesError] = useState<string | null>(null);
    const [rangeDiff, setRangeDiff] = useState<FileDiffPayload | null>(null);
    const [rangeDiffStatus, setRangeDiffStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [rangeDiffError, setRangeDiffError] = useState<string | null>(null);
    const rangeLoadAttempt = useRef(0);
    const rangeDiffAttempt = useRef(0);

    const isolatingRange = commitRange.mode === "range";
    const filesItems = isolatingRange ? (rangeFiles ?? []) : page.files.items;
    const filesStatus = isolatingRange
        ? rangeFilesStatus === "idle"
            ? "loading"
            : rangeFilesStatus
        : page.files.status;
    const filesError = isolatingRange ? rangeFilesError : (page.files.error?.message ?? null);
    const filesEpoch = isolatingRange
        ? `${commitRange.baseOid}:${commitRange.headOid}:${rangeFilesStatus}`
        : page.files.lastLoadedAt;

    const viewedCount = filesItems.filter((file) => fileViewState(viewedMarks, file.path, headSha) === "viewed").length;
    const allViewed = filesStatus === "ready" && filesItems.length > 0 && viewedCount === filesItems.length;
    const showFileDiff = selectedPath !== null && (!allViewed || browsingViewedFile);
    const fileListSelectedPath = showFileDiff ? selectedPath : null;

    useEffect(() => {
        void session.loadPullRequestFiles(repository, number);
        void session.loadReviewThreads(repository, number);
        void session.loadPullRequestCommits(repository, number);
    }, [session, repository, number]);

    useEffect(() => {
        setViewedMarks(readViewedFileMarks(repository, number, headSha));
    }, [repository, number, headSha]);

    useEffect(() => {
        if (commitRange.mode !== "range") {
            setRangeFiles(null);
            setRangeFilesStatus("idle");
            setRangeFilesError(null);
            return;
        }

        const attempt = ++rangeLoadAttempt.current;
        setRangeFilesStatus("loading");
        setRangeFilesError(null);

        void session
            .listComparedFiles(repository, commitRange.baseOid, commitRange.headOid)
            .then((items) => {
                if (attempt !== rangeLoadAttempt.current) {
                    return;
                }
                setRangeFiles(items);
                setRangeFilesStatus("ready");
                setSelectedPath((current) => {
                    if (current && items.some((file) => file.path === current)) {
                        return current;
                    }
                    return items[0]?.path ?? null;
                });
            })
            .catch((cause) => {
                if (attempt !== rangeLoadAttempt.current) {
                    return;
                }
                setRangeFiles([]);
                setRangeFilesStatus("error");
                setRangeFilesError(cause instanceof Error ? cause.message : "Could not load that commit range.");
            });
    }, [session, repository, commitRange]);

    useEffect(() => {
        if (initialPath) {
            setSelectedPath(initialPath);
            setBrowsingViewedFile(true);
            return;
        }

        if (!selectedPath && filesItems[0] && !allViewed) {
            setSelectedPath(filesItems[0].path);
        }
    }, [filesItems, selectedPath, initialPath, allViewed]);

    useEffect(() => {
        if (allViewed && !allViewedRef.current) {
            setBrowsingViewedFile(false);
        }
        allViewedRef.current = allViewed;
    }, [allViewed]);

    function selectFile(path: string) {
        setSelectedPath(path);
        setBrowsingViewedFile(true);
    }

    useEffect(() => {
        if (!selectedPath || !showFileDiff) {
            return;
        }

        if (commitRange.mode !== "range") {
            void session.loadFileDiff(repository, number, selectedPath);
            return;
        }

        const file = filesItems.find((entry) => entry.path === selectedPath) ?? null;
        const attempt = ++rangeDiffAttempt.current;
        setRangeDiff(null);
        setRangeDiffStatus("loading");
        setRangeDiffError(null);

        void session
            .getFileDiffBetween(repository, number, selectedPath, {
                baseOid: commitRange.baseOid,
                headOid: commitRange.headOid,
                previousPath: file?.previousPath ?? null,
            })
            .then((diff) => {
                if (attempt !== rangeDiffAttempt.current) {
                    return;
                }
                setRangeDiff(diff);
                setRangeDiffStatus("ready");
            })
            .catch((cause) => {
                if (attempt !== rangeDiffAttempt.current) {
                    return;
                }
                setRangeDiff(null);
                setRangeDiffStatus("error");
                setRangeDiffError(cause instanceof Error ? cause.message : "Could not load the file.");
            });
    }, [session, repository, number, selectedPath, filesEpoch, commitRange, filesItems, showFileDiff]);

    const pendingOnFile = draft.comments.filter((comment) => comment.path === selectedPath);
    const threadsOnFile = selectedPath ? threads.items.filter((thread) => thread.path === selectedPath) : [];
    const fileCount = filesStatus === "ready" ? filesItems.length : null;
    const selectedFile = filesItems.find((file) => file.path === selectedPath) ?? null;
    const activeDiff = isolatingRange ? rangeDiff : (selectedDiff?.diff ?? null);
    const diffPending = isolatingRange
        ? rangeDiffStatus === "idle" || rangeDiffStatus === "loading"
        : selectedDiff === null ||
          selectedDiff.status === "idle" ||
          selectedDiff.status === "loading" ||
          selectedDiff.refreshing === true;
    const activeDiffError = isolatingRange ? rangeDiffError : (selectedDiff?.error?.message ?? null);
    const selectedViewState = selectedPath ? fileViewState(viewedMarks, selectedPath, headSha) : "unseen";
    const selectionDiffStats = (() => {
        if (isolatingRange) {
            if (rangeFilesStatus !== "ready") {
                return null;
            }
            return filesItems.reduce(
                (totals, file) => ({
                    additions: totals.additions + file.additions,
                    deletions: totals.deletions + file.deletions,
                }),
                { additions: 0, deletions: 0 },
            );
        }
        if (page.detail) {
            return { additions: page.detail.additions, deletions: page.detail.deletions };
        }
        if (filesStatus !== "ready") {
            return null;
        }
        return filesItems.reduce(
            (totals, file) => ({
                additions: totals.additions + file.additions,
                deletions: totals.deletions + file.deletions,
            }),
            { additions: 0, deletions: 0 },
        );
    })();

    function setPathViewed(path: string, viewed: boolean) {
        const nextMarks = { ...viewedMarks };
        if (viewed && headSha) {
            nextMarks[path] = headSha;
        } else {
            delete nextMarks[path];
        }
        setViewedMarks(nextMarks);
        writeViewedFileMarks(repository, number, nextMarks);

        if (viewed) {
            const orderedPaths = filePathsInDisplayOrder(filesItems, preferences.fileListLayout);
            const index = orderedPaths.indexOf(path);
            if (index === -1) {
                return;
            }
            const isViewed = (candidate: string) => fileViewState(nextMarks, candidate, headSha) === "viewed";
            const nextPath =
                orderedPaths.slice(index + 1).find((candidate) => !isViewed(candidate)) ??
                orderedPaths.slice(0, index).find((candidate) => !isViewed(candidate));
            if (nextPath) {
                setSelectedPath(nextPath);
                setBrowsingViewedFile(true);
            }
        }
    }

    async function loadSelectedFileForce() {
        if (!selectedPath) {
            return;
        }
        if (commitRange.mode === "range") {
            const file = filesItems.find((entry) => entry.path === selectedPath) ?? null;
            setRangeDiffStatus("loading");
            setRangeDiffError(null);
            try {
                const diff = await session.getFileDiffBetween(repository, number, selectedPath, {
                    baseOid: commitRange.baseOid,
                    headOid: commitRange.headOid,
                    previousPath: file?.previousPath ?? null,
                    force: true,
                });
                setRangeDiff(diff);
                setRangeDiffStatus("ready");
            } catch (cause) {
                setRangeDiffStatus("error");
                setRangeDiffError(cause instanceof Error ? cause.message : "Could not load the file.");
                throw cause;
            }
            return;
        }
        await session.loadFileDiff(repository, number, selectedPath, { force: true });
    }

    return (
        <div className={cn(preferences.fullWidth && "relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 px-4")}>
            <section id="review" className="flex min-h-0 scroll-mt-20 flex-col overflow-hidden rounded-lg border">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <h2 className="shrink-0 text-sm font-medium">
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
                        <CommitRangePicker
                            commits={commits.items}
                            baseSha={baseSha}
                            range={commitRange}
                            disabled={commits.status !== "ready"}
                            onChange={setCommitRange}
                        />
                        {selectionDiffStats ? (
                            <span
                                className="flex shrink-0 items-center gap-1 text-xs tabular-nums"
                                aria-label={`${selectionDiffStats.additions} additions, ${selectionDiffStats.deletions} deletions`}
                            >
                                <span className="text-emerald-600 dark:text-emerald-400">
                                    +{selectionDiffStats.additions}
                                </span>
                                <span className="text-red-600 dark:text-red-400">−{selectionDiffStats.deletions}</span>
                                <SelectionDiffStatBars
                                    additions={selectionDiffStats.additions}
                                    deletions={selectionDiffStats.deletions}
                                />
                            </span>
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
                                disabled={isolatingRange ? rangeFilesStatus === "loading" : page.files.refreshing}
                                onClick={() => {
                                    if (commitRange.mode === "range") {
                                        setCommitRange({ ...commitRange });
                                        return;
                                    }
                                    void notifyAction(() => session.refreshPullRequestFiles(repository, number), {
                                        loading: "Refreshing files…",
                                        success: "File list refreshed",
                                        error: "Could not refresh files.",
                                    });
                                }}
                            >
                                <RefreshCw
                                    className={cn(
                                        "size-3.5",
                                        (isolatingRange ? rangeFilesStatus === "loading" : page.files.refreshing) &&
                                            "animate-spin",
                                    )}
                                />
                                Refresh
                            </Button>
                        </HelpTooltip>
                        <ReviewChangesMenu repository={repository} number={number} />
                        <DiffSettingsMenu preferences={preferences} onChange={setPreferences} />
                    </div>
                </header>

                {filesError ? <p className="border-b px-3 py-2 text-sm text-destructive">{filesError}</p> : null}

                <div className="flex min-h-0 h-[min(70svh,52rem)] flex-col md:flex-row">
                    <aside
                        className={cn(
                            "relative min-h-0 shrink-0 overflow-hidden border-border",
                            "max-md:border-b max-md:transition-[max-height,opacity,border-color] max-md:duration-300 max-md:ease-[cubic-bezier(0.32,0.72,0,1)]",
                            !resizingFileList &&
                                "md:transition-[width,opacity,border-color] md:duration-300 md:ease-[cubic-bezier(0.32,0.72,0,1)]",
                            "motion-reduce:transition-none",
                            preferences.showFileList
                                ? "max-md:max-h-48 max-md:w-full max-md:opacity-100 md:w-[var(--file-list-width)] md:opacity-100 md:border-r"
                                : "max-md:max-h-0 max-md:border-b-transparent max-md:opacity-0 md:w-0 md:border-r-transparent md:opacity-0",
                        )}
                        style={
                            {
                                ["--file-list-width" as string]: `${fileListWidth}px`,
                            } as CSSProperties
                        }
                        aria-hidden={!preferences.showFileList}
                        inert={!preferences.showFileList ? true : undefined}
                    >
                        <div className="h-full max-md:max-h-48 md:w-full">
                            <FileList
                                files={filesItems}
                                status={filesStatus}
                                selectedPath={fileListSelectedPath}
                                viewedMarks={viewedMarks}
                                headSha={headSha}
                                pendingPaths={new Set(draft.comments.map((comment) => comment.path))}
                                layout={preferences.fileListLayout}
                                onLayoutChange={(fileListLayout) => setPreferences({ fileListLayout })}
                                onSelect={selectFile}
                            />
                        </div>
                        {preferences.showFileList ? (
                            <FileListResizeHandle
                                width={fileListWidth}
                                onChange={(next) => setPreferences({ fileListWidth: next })}
                                onDraggingChange={setResizingFileList}
                            />
                        ) : null}
                    </aside>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2 transition-[padding] duration-300 ease-out motion-reduce:transition-none">
                        {showFileDiff && selectedPath ? (
                            <Suspense fallback={<DiffLoadingSkeleton path={selectedPath} />}>
                                <FileDiffViewer
                                    path={selectedPath}
                                    file={selectedFile}
                                    diff={activeDiff}
                                    isLoading={diffPending}
                                    error={activeDiffError}
                                    pendingComments={pendingOnFile}
                                    threads={threadsOnFile}
                                    viewerLogin={viewer?.login ?? null}
                                    viewerAvatarUrl={viewer?.avatarUrl ?? null}
                                    showInlineComments={!preferences.minimizeComments}
                                    disabled={draft.stale}
                                    repository={repository}
                                    number={number}
                                    canApplySuggestions={page.detail?.state === "open" && !isolatingRange}
                                    mentionUsers={mentionUsers}
                                    layout={preferences.layout}
                                    hideWhitespace={preferences.hideWhitespace}
                                    compactLineHeight={preferences.compactLineHeight}
                                    viewed={selectedViewState === "viewed"}
                                    onViewedChange={(viewed) => setPathViewed(selectedPath, viewed)}
                                    previewBaseUrl={
                                        page.detail
                                            ? `https://github.com/${page.detail.repository}/blob/${page.detail.headRefName}/`
                                            : `https://github.com/${repository}/`
                                    }
                                    onLoadAnyway={() =>
                                        void notifyAction(() => loadSelectedFileForce(), {
                                            loading: "Loading file…",
                                            success: "File loaded",
                                            error: "Could not load the file.",
                                        })
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
                            </Suspense>
                        ) : allViewed ? (
                            <AllFilesViewedPanel />
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

function AllFilesViewedPanel() {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <div
                role="status"
                aria-label="All files viewed"
                className="relative grid size-20 place-items-center rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 text-emerald-600 shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500 dark:text-emerald-400"
            >
                <CheckCircle2 className="size-10 stroke-[1.5]" aria-hidden="true" />
                <span
                    className="pointer-events-none absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:delay-150 dark:bg-emerald-500"
                    aria-hidden="true"
                >
                    ✓
                </span>
            </div>
            <div className="flex max-w-sm flex-col gap-1.5">
                <p className="text-lg font-semibold tracking-tight">Job done!</p>
                <p className="text-sm text-muted-foreground">Nothing left to view — you've been through every file.</p>
                <p className="text-xs text-muted-foreground">Select a file anytime to open its diff again.</p>
            </div>
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

function SelectionDiffStatBars({ additions, deletions }: { additions: number; deletions: number }) {
    const total = additions + deletions;
    if (total === 0) {
        return null;
    }

    const blocks = 5;
    const addBlocks = Math.round((additions / total) * blocks);
    const delBlocks = Math.min(blocks - addBlocks, Math.round((deletions / total) * blocks));

    return (
        <span className="ml-0.5 inline-flex gap-px" aria-hidden="true">
            {Array.from({ length: blocks }, (_, index) => (
                <span
                    key={index}
                    className={cn(
                        "size-1.5 rounded-[1px]",
                        index < addBlocks
                            ? "bg-emerald-500"
                            : index < addBlocks + delBlocks
                              ? "bg-red-500"
                              : "bg-muted-foreground/25",
                    )}
                />
            ))}
        </span>
    );
}

function FileListResizeHandle({
    width,
    onChange,
    onDraggingChange,
}: {
    width: number;
    onChange: (width: number) => void;
    onDraggingChange: (dragging: boolean) => void;
}) {
    const draggingRef = useRef(false);
    const startRef = useRef({ x: 0, width: 0 });

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file list"
            aria-valuenow={width}
            aria-valuemin={FILE_LIST_WIDTH_MIN}
            aria-valuemax={FILE_LIST_WIDTH_MAX}
            tabIndex={0}
            className="group absolute inset-y-0 right-0 z-10 hidden w-3 translate-x-1/2 cursor-col-resize touch-none md:block"
            onPointerDown={(event) => {
                event.preventDefault();
                draggingRef.current = true;
                startRef.current = { x: event.clientX, width };
                onDraggingChange(true);
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (!draggingRef.current) {
                    return;
                }
                const delta = event.clientX - startRef.current.x;
                onChange(clampFileListWidth(startRef.current.width + delta));
            }}
            onPointerUp={(event) => {
                draggingRef.current = false;
                onDraggingChange(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
            }}
            onPointerCancel={() => {
                draggingRef.current = false;
                onDraggingChange(false);
            }}
            onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    onChange(clampFileListWidth(width - 16));
                }
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    onChange(clampFileListWidth(width + 16));
                }
                if (event.key === "Home") {
                    event.preventDefault();
                    onChange(FILE_LIST_WIDTH_MIN);
                }
                if (event.key === "End") {
                    event.preventDefault();
                    onChange(FILE_LIST_WIDTH_MAX);
                }
            }}
        >
            <div className="mx-auto h-full w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-sky-500 group-focus-visible:w-0.5 group-focus-visible:bg-sky-500 group-active:bg-sky-500" />
        </div>
    );
}

function FileList({
    files,
    status,
    selectedPath,
    viewedMarks,
    headSha,
    pendingPaths,
    layout,
    onLayoutChange,
    onSelect,
}: {
    files: Array<PullRequestFile>;
    status: string;
    selectedPath: string | null;
    viewedMarks: ViewedFileMarks;
    headSha: string;
    pendingPaths: Set<string>;
    layout: "flat" | "tree";
    onLayoutChange: (layout: "flat" | "tree") => void;
    onSelect: (path: string) => void;
}) {
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const filter = deferredQuery.trim().toLowerCase();
    const listRef = useRef<HTMLElement>(null);

    const visibleFiles = useMemo(() => {
        if (!filter) {
            return files;
        }
        return files.filter((file) => fileMatchesFilter(file.path, filter));
    }, [files, filter]);

    const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => defaultExpandedDirPaths(tree));

    useEffect(() => {
        setExpandedDirs(defaultExpandedDirPaths(tree));
    }, [tree]);

    useEffect(() => {
        if (!selectedPath) {
            return;
        }

        const selected = listRef.current?.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(selectedPath)}"]`);
        selected?.scrollIntoView({ block: "nearest" });
    }, [selectedPath, visibleFiles, layout]);

    if (status === "loading" || status === "idle") {
        return <FileListLoadingSkeleton />;
    }

    if (files.length === 0) {
        return <p className="p-3 text-sm text-muted-foreground">No files changed.</p>;
    }

    function toggleDir(path: string) {
        setExpandedDirs((current) => {
            const next = new Set(current);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-col gap-1 border-b px-1.5 py-1.5">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && query) {
                                event.preventDefault();
                                setQuery("");
                            }
                        }}
                        placeholder="Filter by path or name"
                        aria-label="Filter files by path or name"
                        className="h-8 pr-8 pl-7 text-xs md:text-xs"
                    />
                    {query ? (
                        <button
                            type="button"
                            className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label="Clear file filter"
                            onClick={() => setQuery("")}
                        >
                            <X className="size-3.5" aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
                <div className="flex items-center justify-end gap-0.5">
                    <HelpTooltip label="Flat file list">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn("size-7", layout === "flat" && "bg-accent")}
                            aria-pressed={layout === "flat"}
                            aria-label="Flat file list"
                            onClick={() => onLayoutChange("flat")}
                        >
                            <List className="size-3.5" aria-hidden="true" />
                        </Button>
                    </HelpTooltip>
                    <HelpTooltip label="Directory tree">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn("size-7", layout === "tree" && "bg-accent")}
                            aria-pressed={layout === "tree"}
                            aria-label="Directory tree"
                            onClick={() => onLayoutChange("tree")}
                        >
                            <ListTree className="size-3.5" aria-hidden="true" />
                        </Button>
                    </HelpTooltip>
                </div>
            </div>
            <nav ref={listRef} aria-label="Changed files" className="min-h-0 flex-1 overflow-auto">
                {visibleFiles.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No files match “{deferredQuery.trim()}”.</p>
                ) : layout === "tree" ? (
                    <ul className="flex w-max min-w-full flex-col py-1">
                        {tree.map((node) => (
                            <FileTreeRows
                                key={node.kind === "dir" ? `dir:${node.path}` : node.file.path}
                                node={node}
                                depth={0}
                                expandedDirs={expandedDirs}
                                selectedPath={selectedPath}
                                viewedMarks={viewedMarks}
                                headSha={headSha}
                                pendingPaths={pendingPaths}
                                onToggleDir={toggleDir}
                                onSelect={onSelect}
                            />
                        ))}
                    </ul>
                ) : (
                    <ul className="flex w-max min-w-full flex-col py-1">
                        {visibleFiles.map((file) => (
                            <li key={file.path}>
                                <FileRow
                                    file={file}
                                    label={file.path}
                                    depth={0}
                                    selected={selectedPath === file.path}
                                    viewState={fileViewState(viewedMarks, file.path, headSha)}
                                    pending={pendingPaths.has(file.path)}
                                    onSelect={onSelect}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </nav>
        </div>
    );
}

function fileMatchesFilter(path: string, filter: string): boolean {
    return path.toLowerCase().includes(filter);
}

function FileTreeRows({
    node,
    depth,
    expandedDirs,
    selectedPath,
    viewedMarks,
    headSha,
    pendingPaths,
    onToggleDir,
    onSelect,
}: {
    node: FileTreeNode;
    depth: number;
    expandedDirs: Set<string>;
    selectedPath: string | null;
    viewedMarks: ViewedFileMarks;
    headSha: string;
    pendingPaths: Set<string>;
    onToggleDir: (path: string) => void;
    onSelect: (path: string) => void;
}) {
    if (node.kind === "file") {
        return (
            <li>
                <FileRow
                    file={node.file}
                    label={node.name}
                    depth={depth}
                    selected={selectedPath === node.file.path}
                    viewState={fileViewState(viewedMarks, node.file.path, headSha)}
                    pending={pendingPaths.has(node.file.path)}
                    onSelect={onSelect}
                />
            </li>
        );
    }

    return (
        <li>
            <DirRow dir={node} depth={depth} expanded={expandedDirs.has(node.path)} onToggle={onToggleDir} />
            {expandedDirs.has(node.path) ? (
                <ul className="flex w-max min-w-full flex-col">
                    {node.children.map((child) => (
                        <FileTreeRows
                            key={child.kind === "dir" ? `dir:${child.path}` : child.file.path}
                            node={child}
                            depth={depth + 1}
                            expandedDirs={expandedDirs}
                            selectedPath={selectedPath}
                            viewedMarks={viewedMarks}
                            headSha={headSha}
                            pendingPaths={pendingPaths}
                            onToggleDir={onToggleDir}
                            onSelect={onSelect}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function DirRow({
    dir,
    depth,
    expanded,
    onToggle,
}: {
    dir: FileTreeDirNode;
    depth: number;
    expanded: boolean;
    onToggle: (path: string) => void;
}) {
    const Chevron = expanded ? ChevronDown : ChevronRight;
    const FolderIcon = expanded ? FolderOpen : Folder;

    return (
        <button
            type="button"
            onClick={() => onToggle(dir.path)}
            className="flex w-max min-w-full cursor-pointer items-center gap-1 py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            aria-expanded={expanded}
        >
            <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
            <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap font-mono">{dir.name}</span>
        </button>
    );
}

function FileRow({
    file,
    label,
    depth,
    selected,
    viewState,
    pending,
    onSelect,
}: {
    file: PullRequestFile;
    label: string;
    depth: number;
    selected: boolean;
    viewState: FileViewState;
    pending: boolean;
    onSelect: (path: string) => void;
}) {
    const viewed = viewState === "viewed";
    const updated = viewState === "updated";

    return (
        <button
            type="button"
            data-file-path={file.path}
            onClick={() => onSelect(file.path)}
            title={
                updated
                    ? `${file.path} — changed since you last viewed it`
                    : viewed
                      ? `${file.path} — viewed`
                      : file.path
            }
            className={cn(
                "flex w-max min-w-full cursor-pointer items-start gap-1.5 py-1.5 pr-2 text-left text-xs hover:bg-accent",
                selected && "bg-accent",
            )}
            style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
        >
            <FileStatusIcon status={file.status} />
            <span className="min-w-0 shrink-0">
                <span
                    className={cn(
                        "block whitespace-nowrap font-mono",
                        file.status === "added" && "text-emerald-700 dark:text-emerald-400",
                        file.status === "removed" && "text-red-700 dark:text-red-400",
                        viewed && "text-muted-foreground",
                    )}
                >
                    {label}
                    {pending ? <span className="ml-1 text-amber-600">•</span> : null}
                </span>
                <span className="mt-0.5 flex flex-nowrap items-center gap-1.5 text-[10px] tabular-nums">
                    {file.additions > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                    ) : null}
                    {file.deletions > 0 ? (
                        <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                    ) : null}
                    {file.stub ? (
                        <span className="uppercase tracking-wide text-muted-foreground">{file.stub}</span>
                    ) : null}
                    {viewed ? (
                        <span className="rounded bg-emerald-500/15 px-1 py-px font-medium tracking-wide text-emerald-700 uppercase dark:bg-emerald-400/15 dark:text-emerald-300">
                            viewed
                        </span>
                    ) : null}
                    {updated ? (
                        <span className="rounded bg-amber-500/20 px-1 py-px font-medium tracking-wide text-amber-800 uppercase dark:bg-amber-400/15 dark:text-amber-200">
                            updated
                        </span>
                    ) : null}
                </span>
            </span>
        </button>
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
