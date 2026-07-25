import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { ArrowLeft, FileCode2, FileDiff, FileMinus2, FilePlus2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { PullRequestFile } from "#/lib/session/types.ts";

import { FileDiffViewer } from "#/components/pr/file-diff-viewer.tsx";
import { ReviewDraftBar } from "#/components/pr/review-draft-bar.tsx";
import { ReviewThreadsPanel } from "#/components/pr/review-threads.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

export function ReviewChanges({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const page = useSelector(session.state, () => session.getPullRequestPage(repository, number));
    const draft = useSelector(session.state, () => session.getReviewDraft(repository, number));
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const selectedDiff = useSelector(session.state, () =>
        selectedPath ? session.getFileDiff(repository, number, selectedPath) : null,
    );

    useEffect(() => {
        void session.loadPullRequest(repository, number);
        void session.loadPullRequestFiles(repository, number);
    }, [session, repository, number]);

    useEffect(() => {
        if (!selectedPath && page.files.items[0]) {
            setSelectedPath(page.files.items[0].path);
        }
    }, [page.files.items, selectedPath]);

    useEffect(() => {
        if (selectedPath) {
            void session.loadFileDiff(repository, number, selectedPath);
        }
    }, [session, repository, number, selectedPath]);

    const headline = page.detail ?? page.summary;
    const [owner = "", repo = ""] = repository.split("/");
    const pendingOnFile = draft.comments.filter((comment) => comment.path === selectedPath);

    return (
        <div className="flex h-[calc(100svh-3rem)] min-h-0 flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Link
                        to="/pr/$owner/$repo/$number"
                        params={{ owner, repo, number: String(number) }}
                        className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="size-3.5" aria-hidden="true" />
                        Overview
                    </Link>
                    <span className="truncate text-sm font-medium">{headline?.title ?? `${repository}#${number}`}</span>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page.files.refreshing}
                    onClick={() => void session.refreshPullRequestFiles(repository, number)}
                >
                    Refresh files
                </Button>
            </header>

            {page.files.error ? (
                <p className="border-b px-4 py-2 text-sm text-destructive">{page.files.error.message}</p>
            ) : null}

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
                <FileList
                    files={page.files.items}
                    status={page.files.status}
                    selectedPath={selectedPath}
                    pendingPaths={new Set(draft.comments.map((comment) => comment.path))}
                    onSelect={setSelectedPath}
                />
                <section className="flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l">
                    {selectedPath ? (
                        <>
                            <h2 className="shrink-0 truncate border-b bg-muted/40 px-3 py-2 font-mono text-xs">
                                {selectedPath}
                            </h2>
                            <FileDiffViewer
                                path={selectedPath}
                                diff={selectedDiff?.diff ?? null}
                                isLoading={selectedDiff?.status === "loading" || selectedDiff?.refreshing === true}
                                error={selectedDiff?.error?.message ?? null}
                                pendingComments={pendingOnFile}
                                disabled={draft.stale}
                                onLoadAnyway={() =>
                                    void session.loadFileDiff(repository, number, selectedPath, { force: true })
                                }
                                onAddComment={(target, body) =>
                                    session
                                        .addPendingComment(repository, number, { ...target, body })
                                        .then(() => undefined)
                                }
                            />
                            <ReviewThreadsPanel repository={repository} number={number} path={selectedPath} />
                        </>
                    ) : (
                        <p className="p-6 text-sm text-muted-foreground">Select a file to review its diff.</p>
                    )}
                </section>
            </div>

            <ReviewDraftBar repository={repository} number={number} />
        </div>
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
    if (status === "loading") {
        return <p className="p-4 text-sm text-muted-foreground">Loading files…</p>;
    }

    if (files.length === 0) {
        return <p className="p-4 text-sm text-muted-foreground">No files changed.</p>;
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
                                "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
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
