import { useEffect, useEffectEvent } from "react";

/** Background revalidate cadence for inbox. No polling while the tab is hidden. */
export const SESSION_REVALIDATE_INTERVAL_MS = 3 * 60 * 1000;

/** How often an open pull request refreshes CI / check rollup while the tab is visible. */
export const CHECK_STATUS_REVALIDATE_INTERVAL_MS = 5_000;

/** Runs `revalidate` every 3 minutes while the document is visible. */
export function useQuietRevalidate(revalidate: () => void) {
    const onRevalidate = useEffectEvent(revalidate);

    useEffect(() => {
        const id = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                onRevalidate();
            }
        }, SESSION_REVALIDATE_INTERVAL_MS);

        return () => window.clearInterval(id);
    }, []);
}

/** Polls `revalidate` every 5 seconds while the document is visible (CI check freshness). */
export function useCheckStatusRevalidate(revalidate: () => void) {
    const onRevalidate = useEffectEvent(revalidate);

    useEffect(() => {
        const id = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                onRevalidate();
            }
        }, CHECK_STATUS_REVALIDATE_INTERVAL_MS);

        return () => window.clearInterval(id);
    }, []);
}
