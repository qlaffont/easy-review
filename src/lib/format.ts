const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
];

/** "3d ago" style freshness, the signal an Inbox row is scanned for. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
    const elapsed = new Date(iso).getTime() - now;
    const magnitude = Math.abs(elapsed);

    for (const { unit, ms } of UNITS) {
        if (magnitude >= ms) {
            return relativeTime.format(Math.round(elapsed / ms), unit);
        }
    }

    return "just now";
}

/**
 * Full local date for hover/tooltips. Built per call with the runtime locale so hour
 * cycle follows the browser/OS (12h vs 24h) instead of a module-load snapshot.
 */
export function formatAbsoluteTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(iso));
}
