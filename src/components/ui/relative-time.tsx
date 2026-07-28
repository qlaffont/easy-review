import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { formatAbsoluteTime, formatRelativeTime } from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";

/** Relative label with the absolute timestamp(s) on hover. */
export function RelativeTime({
    iso,
    createdAt,
    className,
    prefix,
}: {
    /** Primary timestamp shown as relative time (usually `updatedAt`). */
    iso: string;
    /** When set, tooltip lists both created and updated absolute times. */
    createdAt?: string;
    className?: string;
    /** Text placed before the relative time, e.g. "commented". */
    prefix?: string;
}) {
    const relative = formatRelativeTime(iso);
    const label =
        createdAt !== undefined ? (
            <span className="flex flex-col gap-0.5 text-left">
                <span>Created {formatAbsoluteTime(createdAt)}</span>
                <span>Updated {formatAbsoluteTime(iso)}</span>
            </span>
        ) : (
            formatAbsoluteTime(iso)
        );

    return (
        <HelpTooltip label={label}>
            <time dateTime={iso} className={cn("cursor-help underline-offset-2 hover:underline", className)}>
                {prefix ? `${prefix} ${relative}` : relative}
            </time>
        </HelpTooltip>
    );
}
