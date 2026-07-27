import { CheckCircle2, CircleDashed, LoaderCircle, XCircle } from "lucide-react";

import type { CheckRun, CheckState } from "#/lib/session/types.ts";

import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

const CHECK_ORDER: Record<CheckState, number> = {
    failure: 0,
    pending: 1,
    success: 2,
    none: 3,
};

const ROLLUP_TITLE: Record<Exclude<CheckState, "none">, string> = {
    failure: "Some checks were not successful",
    pending: "Some checks have not completed yet",
    success: "All checks have passed",
};

const ROLLUP_TITLE_CLASS: Record<Exclude<CheckState, "none">, string> = {
    failure: "text-red-600 dark:text-red-400",
    pending: "text-amber-700 dark:text-amber-300",
    success: "text-emerald-700 dark:text-emerald-300",
};

/** Colored status icon + popover of jobs for a commit’s check rollup. */
export function CommitChecksMenu({ state, runs }: { state: CheckState; runs: Array<CheckRun> }) {
    if (state === "none") {
        return null;
    }

    const sorted = [...runs].sort(
        (a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name),
    );
    const successCount = runs.filter((run) => run.state === "success").length;
    const failureCount = runs.filter((run) => run.state === "failure").length;
    const pendingCount = runs.filter((run) => run.state === "pending").length;
    const summary = summarizeRollup({ successCount, failureCount, pendingCount, total: runs.length });

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="inline-flex cursor-pointer items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={ROLLUP_TITLE[state]}
                >
                    <CheckStateIcon state={state} className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
                <div className="border-b px-3 py-2.5">
                    <p className={cn("text-sm font-semibold", ROLLUP_TITLE_CLASS[state])}>{ROLLUP_TITLE[state]}</p>
                    {summary ? <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p> : null}
                </div>
                {sorted.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                        Individual jobs aren’t available for this token — open the commit on GitHub for details.
                    </p>
                ) : (
                    <ul className="max-h-80 overflow-y-auto py-1">
                        {sorted.map((run) => (
                            <CheckRunMenuRow key={`${run.name}-${run.url ?? ""}`} run={run} />
                        ))}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
    );
}

function CheckRunMenuRow({ run }: { run: CheckRun }) {
    const muted = run.state === "success";
    const content = (
        <>
            <CheckStateIcon state={run.state} className={cn("size-4 shrink-0", muted && "opacity-55")} />
            <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", muted && "text-muted-foreground")}>{run.name}</span>
                {run.summary ? (
                    <span className="block truncate text-xs text-muted-foreground">{run.summary}</span>
                ) : null}
            </span>
            {run.url ? (
                <span className="shrink-0 text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
                    Details
                </span>
            ) : null}
        </>
    );

    if (run.url) {
        return (
            <li className="border-b border-border/60 last:border-b-0">
                <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/50"
                >
                    {content}
                </a>
            </li>
        );
    }

    return <li className="flex items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">{content}</li>;
}

export function CheckStateIcon({ state, className }: { state: CheckState; className?: string }) {
    switch (state) {
        case "failure":
            return <XCircle className={cn("text-red-600 dark:text-red-400", className)} aria-hidden="true" />;
        case "success":
            return (
                <CheckCircle2 className={cn("text-emerald-600 dark:text-emerald-400", className)} aria-hidden="true" />
            );
        case "pending":
            return (
                <LoaderCircle
                    className={cn("animate-spin text-amber-600 dark:text-amber-400", className)}
                    aria-hidden="true"
                />
            );
        default:
            return <CircleDashed className={cn("text-muted-foreground", className)} aria-hidden="true" />;
    }
}

function summarizeRollup({
    successCount,
    failureCount,
    pendingCount,
    total,
}: {
    successCount: number;
    failureCount: number;
    pendingCount: number;
    total: number;
}): string | null {
    if (total === 0) {
        return null;
    }

    const parts: Array<string> = [];
    if (successCount > 0) {
        parts.push(`${successCount} successful`);
    }
    if (failureCount > 0) {
        parts.push(`${failureCount} failing`);
    }
    if (pendingCount > 0) {
        parts.push(`${pendingCount} pending`);
    }

    if (parts.length === 0) {
        return `${total} checks`;
    }

    if (parts.length === 1) {
        return `${parts[0]} check${(successCount || failureCount || pendingCount) === 1 ? "" : "s"}`;
    }

    const last = parts.pop()!;
    return `${parts.join(", ")} and ${last} checks`;
}
