import type { ReactNode } from "react";

import { Inbox, Loader2 } from "lucide-react";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

/** Spinning loader with a soft pulse ring — used next to skeleton screens. */
export function LoadingIcon({ className, label = "Loading" }: { className?: string; label?: string }) {
    return (
        <span
            role="status"
            aria-label={label}
            className={cn("relative inline-flex size-8 items-center justify-center", className)}
        >
            <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-sky-500/15 motion-safe:animate-[loading-ring_1.4s_ease-out_infinite]"
            />
            <Loader2
                aria-hidden="true"
                className="relative size-4 text-sky-700 motion-safe:animate-spin dark:text-sky-300"
            />
        </span>
    );
}

/** Staggered grid of skeleton cells (CSS delay via `--stagger`). */
export function SkeletonGrid({
    count,
    className,
    renderItem,
}: {
    count: number;
    className?: string;
    renderItem: (index: number) => ReactNode;
}) {
    return (
        <div className={cn("grid gap-2", className)} aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <div
                    key={index}
                    className="motion-safe:animate-[skeleton-enter_420ms_cubic-bezier(0.32,0.72,0,1)_both]"
                    style={{ animationDelay: `${index * 55}ms` }}
                >
                    {renderItem(index)}
                </div>
            ))}
        </div>
    );
}

export function LoadingBanner({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4"
        >
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <LoadingIcon label={label} className="size-7" />
                <span>{label}</span>
            </div>
            {children}
        </div>
    );
}

export function InboxLoadingSkeleton() {
    return (
        <LoadingBanner label="Loading pull requests…">
            <SkeletonGrid
                count={6}
                className="grid-cols-1"
                renderItem={() => (
                    <div className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5">
                        <Skeleton className="size-8 shrink-0 rounded-full" />
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <Skeleton className="h-3.5 w-[70%]" />
                            <Skeleton className="h-3 w-[42%]" />
                        </div>
                        <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
                    </div>
                )}
            />
        </LoadingBanner>
    );
}

export function PullRequestLoadingSkeleton({ repository, number }: { repository: string; number: number }) {
    return (
        <LoadingBanner label={`Loading ${repository}#${number}…`}>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-7 w-[75%]" />
                    <Skeleton className="h-4 w-[45%]" />
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
                    <SkeletonGrid
                        count={4}
                        className="grid-cols-1"
                        renderItem={(index) =>
                            index === 0 ? (
                                <div className="flex flex-col gap-3 rounded-md border bg-background p-4">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="h-3 w-full" />
                                    <Skeleton className="h-3 w-[92%]" />
                                    <Skeleton className="h-3 w-[78%]" />
                                </div>
                            ) : (
                                <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-3">
                                    <Skeleton className="size-6 shrink-0 rounded-full" />
                                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                                        <Skeleton className="h-3 w-32" />
                                        <Skeleton className="h-3 w-full" />
                                        <Skeleton className="h-3 w-[85%]" />
                                    </div>
                                </div>
                            )
                        }
                    />
                    <SkeletonGrid
                        count={3}
                        className="grid-cols-1"
                        renderItem={() => (
                            <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="h-3 w-full" />
                                <Skeleton className="h-3 w-[70%]" />
                            </div>
                        )}
                    />
                </div>
            </div>
        </LoadingBanner>
    );
}

export function FileListLoadingSkeleton() {
    return (
        <div role="status" aria-label="Loading files" className="flex flex-col gap-2 p-3">
            <div className="mb-1 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoadingIcon label="Loading files" className="size-5" />
                <span>Loading files…</span>
            </div>
            <SkeletonGrid
                count={8}
                className="grid-cols-1"
                renderItem={() => (
                    <div className="flex items-start gap-2 px-1 py-1">
                        <Skeleton className="mt-0.5 size-3.5 shrink-0 rounded-sm" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <Skeleton className="h-3 w-[88%]" />
                            <Skeleton className="h-2.5 w-16" />
                        </div>
                    </div>
                )}
            />
        </div>
    );
}

export function DiffLoadingSkeleton({ path }: { path: string }) {
    return (
        <div
            role="status"
            aria-label={`Loading ${path}`}
            className="flex min-h-[min(60vh,28rem)] flex-1 flex-col gap-3 p-4"
        >
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <LoadingIcon label={`Loading ${path}`} className="size-7" />
                <span className="truncate font-medium">Loading diff…</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{path}</p>
            <SkeletonGrid
                count={14}
                className="grid-cols-1 flex-1"
                renderItem={(index) => (
                    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                        <Skeleton className="h-3.5 w-8 justify-self-end" />
                        <Skeleton
                            className={cn(
                                "h-3.5",
                                index % 3 === 0 ? "w-[72%]" : index % 3 === 1 ? "w-[90%]" : "w-[58%]",
                            )}
                        />
                    </div>
                )}
            />
        </div>
    );
}

export function ConversationLoadingSkeleton() {
    return (
        <div role="status" aria-label="Loading timeline" className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingIcon label="Loading timeline" className="size-6" />
                <span>Loading timeline…</span>
            </div>
            <SkeletonGrid
                count={4}
                className="grid-cols-1"
                renderItem={() => (
                    <div className="flex items-start gap-3">
                        <Skeleton className="size-7 shrink-0 rounded-full" />
                        <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border p-3">
                            <Skeleton className="h-3 w-36" />
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className="h-3 w-[80%]" />
                        </div>
                    </div>
                )}
            />
        </div>
    );
}

export function DescriptionLoadingSkeleton() {
    return (
        <div role="status" aria-label="Loading description" className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingIcon label="Loading description" className="size-6" />
                <span>Loading the description…</span>
            </div>
            <SkeletonGrid
                count={3}
                className="grid-cols-1"
                renderItem={(index) => <Skeleton className={cn("h-3", index === 2 ? "w-[60%]" : "w-full")} />}
            />
        </div>
    );
}

/** PR overview right rail while detail (checks / reviewers / assignees / labels) is still loading. */
export function SidebarMetadataLoadingSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading pull request metadata"
            aria-busy="true"
            className="flex flex-col gap-5 text-sm"
        >
            <section className="flex flex-col gap-2">
                <Skeleton className="h-3 w-14" />
                <SkeletonGrid
                    count={3}
                    className="grid-cols-1"
                    renderItem={(index) => (
                        <div className="flex items-center gap-2">
                            <Skeleton className="size-3.5 shrink-0 rounded-full" />
                            <Skeleton
                                className={cn("h-3", index === 0 ? "w-[72%]" : index === 1 ? "w-[58%]" : "w-[64%]")}
                            />
                        </div>
                    )}
                />
            </section>

            <div className="flex flex-col divide-y">
                <section className="flex flex-col gap-2 pb-5">
                    <Skeleton className="h-3 w-16" />
                    <SkeletonGrid
                        count={2}
                        className="grid-cols-1"
                        renderItem={() => (
                            <div className="flex items-center gap-2">
                                <Skeleton className="size-5 shrink-0 rounded-full" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        )}
                    />
                </section>
                <section className="flex flex-col gap-2 py-5">
                    <Skeleton className="h-3 w-20" />
                    <div className="flex items-center gap-2">
                        <Skeleton className="size-5 shrink-0 rounded-full" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                </section>
                <section className="flex flex-col gap-2 pt-5">
                    <Skeleton className="h-3 w-12" />
                    <div className="flex flex-wrap gap-1.5">
                        <Skeleton className="h-5 w-16 rounded-full" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                        <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                </section>
            </div>
        </div>
    );
}

export function RepoPickerLoadingSkeleton() {
    return (
        <div role="status" aria-label="Loading repositories" className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoadingIcon label="Asking GitHub" className="size-6" />
                <span>Asking GitHub…</span>
            </div>
            <SkeletonGrid
                count={6}
                className="grid-cols-1 px-1"
                renderItem={() => (
                    <div className="flex items-center gap-3 rounded-md px-2 py-2">
                        <Skeleton className="size-4 shrink-0 rounded-sm" />
                        <Skeleton className="h-3.5 w-[70%]" />
                    </div>
                )}
            />
        </div>
    );
}

export function BootLoadingScreen() {
    return (
        <div className="grid min-h-svh place-items-center px-6">
            <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex flex-col items-center gap-2 text-center">
                    <span
                        role="status"
                        aria-label="Loading Easy Review"
                        className="grid size-10 place-items-center rounded-xl border border-sky-500/35 bg-sky-500/15 text-sky-700 dark:border-sky-400/40 dark:text-sky-300"
                    >
                        <Inbox className="size-5" aria-hidden="true" />
                    </span>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Loading Easy Review</p>
                        <p className="text-xs text-muted-foreground">Restoring your session…</p>
                    </div>
                </div>
                <div className="flex w-56 gap-2" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                        <span
                            key={index}
                            className="h-2 flex-1 rounded-full bg-sky-500/35 motion-safe:animate-[boot-bar_1.05s_ease-in-out_infinite]"
                            style={{ animationDelay: `${index * 140}ms` }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Overlay shown while a lazy dialog / panel chunk downloads. */
export function LazyChunkFallback({ label = "Loading…" }: { label?: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            className="fixed inset-0 z-50 grid place-items-center bg-background/50 backdrop-blur-[1px]"
        >
            <div className="flex items-center gap-2.5 rounded-lg border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-md">
                <LoadingIcon label={label} className="size-7" />
                <span>{label}</span>
            </div>
        </div>
    );
}
