import { GitCommitHorizontal } from "lucide-react";

import { CheckStateIcon } from "#/components/pr/commit-checks-menu.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { usePullRequestCommitsQuery } from "#/lib/query/pull-request.ts";

export function PullRequestCommits({ repository, number }: { repository: string; number: number }) {
    const commits = usePullRequestCommitsQuery(repository, number);

    return (
        <section
            id="commits"
            aria-label="Commits"
            className="scroll-mt-20 overflow-hidden rounded-lg border bg-background"
        >
            <header className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                    <GitCommitHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    Commits
                </h2>
                {commits.status === "ready" ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {commits.items.length} {commits.items.length === 1 ? "commit" : "commits"}
                    </span>
                ) : null}
            </header>

            {commits.status === "loading" || commits.status === "idle" ? (
                <ul className="flex flex-col gap-0 divide-y" aria-busy="true" aria-label="Loading commits">
                    {Array.from({ length: 3 }, (_, index) => (
                        <li key={index} className="flex items-center gap-3 px-3 py-2.5">
                            <Skeleton className="size-6 shrink-0 rounded-full" />
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <Skeleton className="h-3.5 w-[70%]" />
                                <Skeleton className="h-3 w-28" />
                            </div>
                            <Skeleton className="h-3 w-14" />
                        </li>
                    ))}
                </ul>
            ) : null}

            {commits.error ? <p className="px-3 py-4 text-sm text-destructive">{commits.error.message}</p> : null}

            {commits.status === "ready" && commits.items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No commits on this pull request.</p>
            ) : null}

            {commits.status === "ready" && commits.items.length > 0 ? (
                <ol className="flex flex-col divide-y">
                    {commits.items.map((commit) => (
                        <li key={commit.oid} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
                            {commit.authorAvatarUrl ||
                            (/^[\w-]+$/.test(commit.authorLogin) && commit.authorLogin !== "ghost") ? (
                                <img
                                    src={
                                        commit.authorAvatarUrl ?? `https://github.com/${commit.authorLogin}.png?size=48`
                                    }
                                    alt=""
                                    className="mt-0.5 size-6 shrink-0 rounded-full"
                                />
                            ) : (
                                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase">
                                    {commit.authorLogin.slice(0, 1)}
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <a
                                    href={commit.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block truncate text-sm font-medium hover:underline"
                                >
                                    {commit.messageHeadline}
                                </a>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{commit.authorLogin}</span>
                                    <span>committed</span>
                                    <RelativeTime iso={commit.committedAt} />
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 pt-0.5">
                                <CheckStateIcon state={commit.checkState} className="size-3.5" />
                                <a
                                    href={commit.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                                >
                                    {commit.abbreviatedOid}
                                </a>
                            </div>
                        </li>
                    ))}
                </ol>
            ) : null}
        </section>
    );
}
