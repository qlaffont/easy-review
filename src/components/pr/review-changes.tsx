import { useSelector } from "@tanstack/react-store";
import {
    ChevronDown,
    ChevronRight,
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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from "react";

import type { PullRequestFile } from "#/lib/session/types.ts";

import { DiffSettingsMenu } from "#/components/pr/diff-settings-menu.tsx";
import { ReviewChangesMenu } from "#/components/pr/review-changes-menu.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { DiffLoadingSkeleton, FileListLoadingSkeleton } from "#/components/ui/loading.tsx";
import { mentionCandidatesFromPullRequest } from "#/lib/composer-commands.ts";
import {
    clampFileListWidth,
    FILE_LIST_WIDTH_MAX,
    FILE_LIST_WIDTH_MIN,
    readViewedPaths,
    useDiffPreferences,
    writeViewedPaths,
} from "#/lib/diff-preferences.ts";
import { buildFileTree, defaultExpandedDirPaths, type FileTreeDirNode, type FileTreeNode } from "#/lib/file-tree.ts";
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
    const [resizingFileList, setResizingFileList] = useState(false);
    const fileListWidth = preferences.fileListWidth;

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
                                files={page.files.items}
                                status={page.files.status}
                                selectedPath={selectedPath}
                                viewedPaths={viewedPaths}
                                pendingPaths={new Set(draft.comments.map((comment) => comment.path))}
                                layout={preferences.fileListLayout}
                                onLayoutChange={(fileListLayout) => setPreferences({ fileListLayout })}
                                onSelect={setSelectedPath}
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
                        {selectedPath ? (
                            <Suspense fallback={<DiffLoadingSkeleton path={selectedPath} />}>
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
                                            () =>
                                                session.loadFileDiff(repository, number, selectedPath, { force: true }),
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
                            </Suspense>
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
    viewedPaths,
    pendingPaths,
    layout,
    onLayoutChange,
    onSelect,
}: {
    files: Array<PullRequestFile>;
    status: string;
    selectedPath: string | null;
    viewedPaths: Set<string>;
    pendingPaths: Set<string>;
    layout: "flat" | "tree";
    onLayoutChange: (layout: "flat" | "tree") => void;
    onSelect: (path: string) => void;
}) {
    const tree = useMemo(() => buildFileTree(files), [files]);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => defaultExpandedDirPaths(tree));

    useEffect(() => {
        setExpandedDirs(defaultExpandedDirPaths(tree));
    }, [tree]);

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
            <div className="flex shrink-0 items-center justify-end gap-0.5 border-b px-1.5 py-1">
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
            <nav aria-label="Changed files" className="min-h-0 flex-1 overflow-y-auto">
                {layout === "tree" ? (
                    <ul className="flex flex-col py-1">
                        {tree.map((node) => (
                            <FileTreeRows
                                key={node.kind === "dir" ? `dir:${node.path}` : node.file.path}
                                node={node}
                                depth={0}
                                expandedDirs={expandedDirs}
                                selectedPath={selectedPath}
                                viewedPaths={viewedPaths}
                                pendingPaths={pendingPaths}
                                onToggleDir={toggleDir}
                                onSelect={onSelect}
                            />
                        ))}
                    </ul>
                ) : (
                    <ul className="flex flex-col py-1">
                        {files.map((file) => (
                            <li key={file.path}>
                                <FileRow
                                    file={file}
                                    label={file.path}
                                    depth={0}
                                    selected={selectedPath === file.path}
                                    viewed={viewedPaths.has(file.path)}
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

function FileTreeRows({
    node,
    depth,
    expandedDirs,
    selectedPath,
    viewedPaths,
    pendingPaths,
    onToggleDir,
    onSelect,
}: {
    node: FileTreeNode;
    depth: number;
    expandedDirs: Set<string>;
    selectedPath: string | null;
    viewedPaths: Set<string>;
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
                    viewed={viewedPaths.has(node.file.path)}
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
                <ul className="flex flex-col">
                    {node.children.map((child) => (
                        <FileTreeRows
                            key={child.kind === "dir" ? `dir:${child.path}` : child.file.path}
                            node={child}
                            depth={depth + 1}
                            expandedDirs={expandedDirs}
                            selectedPath={selectedPath}
                            viewedPaths={viewedPaths}
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
            className="flex w-full cursor-pointer items-center gap-1 py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            aria-expanded={expanded}
        >
            <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
            <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono">{dir.name}</span>
        </button>
    );
}

function FileRow({
    file,
    label,
    depth,
    selected,
    viewed,
    pending,
    onSelect,
}: {
    file: PullRequestFile;
    label: string;
    depth: number;
    selected: boolean;
    viewed: boolean;
    pending: boolean;
    onSelect: (path: string) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onSelect(file.path)}
            title={file.path}
            className={cn(
                "flex w-full cursor-pointer items-start gap-1.5 py-1.5 pr-2 text-left text-xs hover:bg-accent",
                selected && "bg-accent",
                viewed && "opacity-60",
            )}
            style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
        >
            <FileStatusIcon status={file.status} />
            <span className="min-w-0 flex-1">
                <span
                    className={cn(
                        "block truncate font-mono",
                        file.status === "added" && "text-emerald-700 dark:text-emerald-400",
                        file.status === "removed" && "text-red-700 dark:text-red-400",
                    )}
                >
                    {label}
                    {pending ? <span className="ml-1 text-amber-600">•</span> : null}
                </span>
                <span className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground tabular-nums">
                    {file.additions > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                    ) : null}
                    {file.deletions > 0 ? (
                        <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                    ) : null}
                    {file.stub ? <span className="uppercase tracking-wide">{file.stub}</span> : null}
                    {viewed ? <span>viewed</span> : null}
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
