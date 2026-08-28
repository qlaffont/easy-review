import { useEffect, useRef } from "react";

import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { CHECK_STATUS_REVALIDATE_INTERVAL_MS } from "#/lib/session/quiet-revalidate.ts";
import { notifySuccess } from "#/lib/toast.ts";

/**
 * While Easy Review is open, complete queued auto-merges as soon as GitHub reports the
 * pull request ready. Runs even in a hidden tab so leaving the window does not stall the queue.
 */
export function QueuedAutoMergeWatcher() {
    const session = useSession();
    const login = useSessionState((state) => state.auth.viewer?.login ?? "");
    const syncing = useRef(false);

    useEffect(() => {
        if (!login) {
            return;
        }

        let cancelled = false;

        async function processQueue() {
            if (syncing.current) {
                return;
            }

            syncing.current = true;
            try {
                const merged = await session.processQueuedAutoMerges();
                if (cancelled) {
                    return;
                }
                for (const item of merged) {
                    notifySuccess(`Merged ${item.repository}#${item.number}`);
                }
            } finally {
                syncing.current = false;
            }
        }

        void processQueue();
        const timer = window.setInterval(() => {
            void processQueue();
        }, CHECK_STATUS_REVALIDATE_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [login, session]);

    return null;
}
