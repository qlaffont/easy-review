import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import { useInboxPreferences } from "#/lib/inbox-preferences.ts";
import { showInboxUpdateNotifications } from "#/lib/inbox/inbox-notifications.ts";
import {
    detectInboxUpdates,
    snapshotExpandedSections,
    type ExpandedSectionSnapshot,
} from "#/lib/inbox/inbox-update-detection.ts";
import { getInboxQueryData } from "#/lib/query/inbox.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS } from "#/lib/session/quiet-revalidate.ts";

/**
 * While the tab is hidden, refresh the inbox every five minutes and notify when
 * pull requests in expanded sections change.
 */
export function InboxBackgroundWatcher() {
    const session = useSession();
    const queryClient = useQueryClient();
    const login = useSessionState((state) => state.auth.viewer?.login ?? "");
    const expandedSections = useSessionState((state) => state.inbox.expandedSections);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    const lastLoadedAt = useSessionState((state) => state.inbox.lastLoadedAt);
    const [preferences] = useInboxPreferences();
    const lastSnapshot = useRef<ExpandedSectionSnapshot>(new Map());
    const syncing = useRef(false);

    const captureSnapshot = useEffectEvent(() => {
        if (!login) {
            lastSnapshot.current = new Map();
            return;
        }
        lastSnapshot.current = snapshotExpandedSections(getInboxQueryData(queryClient, login), expandedSections);
    });

    const syncWhenHidden = useEffectEvent(async () => {
        if (!login || selectedCount === 0 || !preferences.backgroundNotifications) {
            return;
        }
        if (document.visibilityState !== "hidden") {
            return;
        }
        if (syncing.current) {
            return;
        }

        syncing.current = true;
        const before = new Map(lastSnapshot.current);

        try {
            await session.refreshInbox();
            const after = snapshotExpandedSections(getInboxQueryData(queryClient, login), expandedSections);
            lastSnapshot.current = after;

            if (before.size === 0) {
                return;
            }

            const updates = detectInboxUpdates(before, after);
            showInboxUpdateNotifications(updates);
        } finally {
            syncing.current = false;
        }
    });

    useEffect(() => {
        if (document.visibilityState !== "visible") {
            return;
        }
        captureSnapshot();
    }, [login, expandedSections, lastLoadedAt]);

    useEffect(() => {
        function onVisibilityChange() {
            if (document.visibilityState === "visible") {
                captureSnapshot();
                return;
            }
            void syncWhenHidden();
        }

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, []);

    useEffect(() => {
        if (!login || selectedCount === 0 || !preferences.backgroundNotifications) {
            return;
        }

        const timer = window.setInterval(() => {
            void syncWhenHidden();
        }, BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [login, selectedCount, preferences.backgroundNotifications]);

    return null;
}
