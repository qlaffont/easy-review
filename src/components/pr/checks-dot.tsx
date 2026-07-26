import type { CheckState } from "#/lib/session/types.ts";

import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { cn } from "#/lib/utils.ts";

const CHECK_LABELS: Record<CheckState, string> = {
    none: "No checks",
    pending: "Checks running",
    success: "Checks passed",
    failure: "Checks failed",
};

const CHECK_COLORS: Record<CheckState, string> = {
    none: "bg-muted-foreground/30",
    pending: "bg-amber-500",
    success: "bg-emerald-500",
    failure: "bg-red-500",
};

/** The one place check colour is decided, so a row and an overview never disagree. */
export function ChecksDot({ state, label = CHECK_LABELS[state] }: { state: CheckState; label?: string }) {
    return (
        <HelpTooltip label={label}>
            <span aria-label={label} className={cn("inline-block size-2 shrink-0 rounded-full", CHECK_COLORS[state])} />
        </HelpTooltip>
    );
}
