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
