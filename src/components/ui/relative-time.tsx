import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { formatAbsoluteTime, formatRelativeTime } from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";

/** Relative label with the absolute timestamp on hover. */
export function RelativeTime({
    iso,
    className,
    prefix,
}: {
    iso: string;
    className?: string;
    /** Text placed before the relative time, e.g. "commented". */
    prefix?: string;
}) {
    const relative = formatRelativeTime(iso);
    const absolute = formatAbsoluteTime(iso);

    return (
        <HelpTooltip label={absolute}>
            <time dateTime={iso} className={cn("cursor-help underline-offset-2 hover:underline", className)}>
                {prefix ? `${prefix} ${relative}` : relative}
            </time>
        </HelpTooltip>
    );
}
