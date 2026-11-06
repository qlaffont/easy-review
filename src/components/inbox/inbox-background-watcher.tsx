import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import { useInboxPreferences } from "#/lib/inbox-preferences.ts";
import { armInboxChime } from "#/lib/inbox/inbox-chime.ts";
import { isTabAttended, showNewPullRequestNotifications } from "#/lib/inbox/inbox-notifications.ts";
import {
    detectNewPullRequests,
    snapshotSectionMembership,
    type SectionMembershipSnapshot,
} from "#/lib/inbox/inbox-update-detection.ts";
import { getInboxQueryData } from "#/lib/query/inbox.ts";
import { defaultLabelForSection } from "#/lib/session/inbox-sections.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS } from "#/lib/session/quiet-revalidate.ts";

/**
 * While the user is away from this tab (hidden or not focused), refresh the inbox every
 * five minutes and notify when a pull request appears in a section marked for notifications.
 */
export function InboxBackgroundWatcher() {
    const session = useSession();
    const queryClient = useQueryClient();
    const login = useSessionState((state) => state.auth.viewer?.login ?? "");
    const sectionLayout = useSessionState((state) => state.inbox.sectionLayout);
    const selectedCount = useSessionState((state) => state.repos.selected.length);
    const lastLoadedAt = useSessionState((state) => state.inbox.lastLoadedAt);
    const [preferences] = useInboxPreferences();
    const watchedSections = useMemo(
        () => sectionLayout.filter((entry) => !entry.hidden && entry.notifyOnNewPullRequest),
        [sectionLayout],
    );
    const lastSeen = useRef<SectionMembershipSnapshot>(new Map());
    const syncing = useRef(false);

    /** What the user has seen: only moves forward while they are looking at the tab. */
    const captureLastSeen = useEffectEvent(() => {
        lastSeen.current = snapshotSectionMembership(
            login ? getInboxQueryData(queryClient, login) : undefined,
            watchedSections.map((entry) => entry.id),
        );
    });

    const syncWhenAway = useEffectEvent(async () => {
        if (!login || selectedCount === 0 || !preferences.backgroundNotifications) {
            return;
        }
        if (isTabAttended() || syncing.current) {
            return;
        }

        syncing.current = true;

        try {
            await session.refreshInbox();

            const data = getInboxQueryData(queryClient, login);
            const sectionIds = watchedSections.map((entry) => entry.id);
            const entered = detectNewPullRequests(lastSeen.current, data, sectionIds);
            lastSeen.current = snapshotSectionMembership(data, sectionIds);

            showNewPullRequestNotifications(
                entered.map(({ pullRequest, sectionId }) => {
                    const section = watchedSections.find((entry) => entry.id === sectionId);
                    return {
                        repository: pullRequest.repository,
                        number: pullRequest.number,
                        key: pullRequest.key,
                        title: pullRequest.title,
                        sectionLabel: section?.label.trim() || defaultLabelForSection(sectionId),
                    };
                }),
            );
        } finally {
            syncing.current = false;
        }
    });

    useEffect(() => {
        if (isTabAttended()) {
            captureLastSeen();
        }
    }, [login, watchedSections, lastLoadedAt]);

    useEffect(() => {
        function onAttentionChange() {
            if (isTabAttended()) {
                captureLastSeen();
            }
        }

        window.addEventListener("focus", onAttentionChange);
        document.addEventListener("visibilitychange", onAttentionChange);
        return () => {
            window.removeEventListener("focus", onAttentionChange);
            document.removeEventListener("visibilitychange", onAttentionChange);
        };
    }, []);

    useEffect(() => {
        if (!preferences.backgroundNotifications) {
            return;
        }
        return armInboxChime();
    }, [preferences.backgroundNotifications]);

    useEffect(() => {
        if (!login || selectedCount === 0 || !preferences.backgroundNotifications) {
            return;
        }

        const timer = window.setInterval(() => {
            void syncWhenAway();
        }, BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [login, selectedCount, preferences.backgroundNotifications]);

    return null;
}
