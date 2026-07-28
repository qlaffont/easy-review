import type { ReviewThread } from "#/lib/session/types.ts";

import { cn } from "#/lib/utils.ts";

/** Inline status chips for a review thread header (outdated / resolved). */
export function ReviewThreadStatusLabels({
    thread,
    className,
}: {
    thread: Pick<ReviewThread, "isOutdated" | "isResolved">;
    className?: string;
}) {
    if (!thread.isOutdated && !thread.isResolved) {
        return null;
    }

    return (
        <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
            {thread.isOutdated ? (
                <span className="rounded bg-amber-500/15 px-1 py-px font-medium tracking-wide text-amber-800 uppercase dark:bg-amber-400/15 dark:text-amber-200">
                    outdated
                </span>
            ) : null}
            {thread.isResolved ? (
                <span className="rounded bg-muted px-1 py-px font-medium tracking-wide text-muted-foreground uppercase">
                    resolved
                </span>
            ) : null}
        </span>
    );
}
