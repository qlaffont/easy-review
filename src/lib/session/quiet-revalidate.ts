import { useEffect, useEffectEvent } from "react";

/** Background revalidate cadence for inbox + open PR. No polling while the tab is hidden. */
export const SESSION_REVALIDATE_INTERVAL_MS = 3 * 60 * 1000;

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
