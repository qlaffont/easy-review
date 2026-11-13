import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { isGithubRateLimitLow } from "#/lib/github/rate-limit.ts";
import { useInboxPreferences } from "#/lib/inbox-preferences.ts";
import { armInboxChime } from "#/lib/inbox/inbox-chime.ts";
import { isTabAttended, showNewPullRequestNotifications } from "#/lib/inbox/inbox-notifications.ts";
import {
    claimInboxSyncLeadership,
    isNewerInboxLoad,
    openInboxBroadcast,
    type InboxBroadcast,
    type InboxBroadcastMessage,
    type InboxSyncLeadership,
} from "#/lib/inbox/inbox-sync-coordination.ts";
import {
    detectNewPullRequests,
    snapshotSectionMembership,
    type SectionMembershipSnapshot,
} from "#/lib/inbox/inbox-update-detection.ts";
import { getInboxQueryData } from "#/lib/query/inbox.ts";
import { defaultLabelForSection } from "#/lib/session/inbox-sections.ts";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS } from "#/lib/session/quiet-revalidate.ts";
import { useTabFavicon } from "#/lib/tab-favicon.ts";

/** Broadcast once a burst of section loads settles, not once per section. */
const BROADCAST_DEBOUNCE_MS = 1_000;
/** Skip a background sync when another tab shared data at least this recent. */
const SHARED_DATA_FRESH_MS = BACKGROUND_INBOX_REVALIDATE_INTERVAL_MS / 2;

/**
 * While the user is away from Easy Review, one tab (the leader) refreshes the inbox every five
 * minutes and shares the result with the other tabs. Every tab then notifies when a pull request
 * appears in a section marked for notifications, so the chime can come from a tab allowed to play
 * it. On the Inbox page the favicon also shows an unread dot until the user comes back to the tab.
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
    const leadership = useRef<InboxSyncLeadership | null>(null);
    const broadcast = useRef<InboxBroadcast | null>(null);
    /** `lastLoadedAt` of the data last adopted from another tab: never echoed back. */
    const adoptedLoadedAt = useRef<string | null>(null);
    const [hasUnseenPullRequests, setHasUnseenPullRequests] = useState(false);
    const onInbox = useRouterState({ select: (state) => state.location.pathname === "/" });
    useTabFavicon(onInbox && hasUnseenPullRequests ? "inbox-new" : null);

    /** What the user has seen: only moves forward while they are looking at the tab. */
    const captureLastSeen = useEffectEvent(() => {
        setHasUnseenPullRequests(false);
        lastSeen.current = snapshotSectionMembership(
            login ? getInboxQueryData(queryClient, login) : undefined,
            watchedSections.map((entry) => entry.id),
        );
    });

    /** Compare the inbox against what the user last saw, and flag or notify what entered. */
    const notifyNewPullRequests = useEffectEvent(() => {
        const data = getInboxQueryData(queryClient, login);
        const sectionIds = watchedSections.map((entry) => entry.id);
        const entered = detectNewPullRequests(lastSeen.current, data, sectionIds);
        lastSeen.current = snapshotSectionMembership(data, sectionIds);

        // The user may have come back while the refresh ran.
        if (entered.length > 0 && !isTabAttended()) {
            setHasUnseenPullRequests(true);
        }

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
    });

    const syncWhenAway = useEffectEvent(async () => {
        if (!login || selectedCount === 0 || !preferences.backgroundNotifications) {
            return;
        }
        if (isTabAttended() || syncing.current || !leadership.current?.isLeader()) {
            return;
        }
        // Another tab shared fresh data, or GitHub's budget is nearly spent.
        const shared = getInboxQueryData(queryClient, login)?.lastLoadedAt;
        if (shared && Date.now() - Date.parse(shared) < SHARED_DATA_FRESH_MS) {
            return;
        }
        if (isGithubRateLimitLow()) {
            return;
        }

        syncing.current = true;

        try {
            await session.refreshInbox();
            notifyNewPullRequests();
        } finally {
            syncing.current = false;
        }
    });

    const adoptSharedInbox = useEffectEvent((message: InboxBroadcastMessage) => {
        if (!login || message.login !== login) {
            return;
        }
        const current = getInboxQueryData(queryClient, login)?.lastLoadedAt ?? null;
        if (!isNewerInboxLoad(message.data.lastLoadedAt, current)) {
            return;
        }

        adoptedLoadedAt.current = message.data.lastLoadedAt;
        session.adoptInboxData(message.data);

        if (preferences.backgroundNotifications && !isTabAttended()) {
            notifyNewPullRequests();
        }
    });

    useEffect(() => {
        const channel = openInboxBroadcast((message) => adoptSharedInbox(message));
        broadcast.current = channel;
        return () => {
            broadcast.current = null;
            channel.close();
        };
    }, []);

    // Share every fresh load (manual refresh, quiet revalidate, background sync) with the other tabs.
    useEffect(() => {
        if (!login || !lastLoadedAt || lastLoadedAt === adoptedLoadedAt.current) {
            return;
        }
        const timer = window.setTimeout(() => {
            const data = getInboxQueryData(queryClient, login);
            if (data?.lastLoadedAt && data.lastLoadedAt !== adoptedLoadedAt.current) {
                broadcast.current?.post({ login, data });
            }
        }, BROADCAST_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [login, lastLoadedAt, queryClient]);

    useEffect(() => {
        if (!login || !preferences.backgroundNotifications) {
            return;
        }
        const claimed = claimInboxSyncLeadership();
        leadership.current = claimed;
        return () => {
            leadership.current = null;
            claimed.close();
        };
    }, [login, preferences.backgroundNotifications]);

    useEffect(() => {
        if (isTabAttended()) {
            captureLastSeen();
        }
    }, [login, watchedSections, lastLoadedAt]);

    useEffect(() => {
        function onAttentionChange() {
            if (isTabAttended()) {
                captureLastSeen();
                // A tab the user is looking at does not sync: let one in the background lead.
                leadership.current?.yieldLeadership();
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
