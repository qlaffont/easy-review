import type { InboxPullRequestUpdate } from "#/lib/inbox/inbox-update-detection.ts";

import { inboxPreferencesEnabled } from "#/lib/inbox-preferences.ts";

export function notificationPermission(): NotificationPermission | "unsupported" {
    if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
    }
    return Notification.permission;
}

export async function requestInboxNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
    const current = notificationPermission();
    if (current !== "default") {
        return current;
    }

    try {
        return await Notification.requestPermission();
    } catch {
        return "denied";
    }
}

/** Show desktop notifications for inbox updates. No-op when disabled, denied, or tab is visible. */
export function showInboxUpdateNotifications(updates: ReadonlyArray<InboxPullRequestUpdate>): void {
    if (updates.length === 0) {
        return;
    }
    if (!inboxPreferencesEnabled()) {
        return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
        return;
    }
    if (notificationPermission() !== "granted") {
        return;
    }

    if (updates.length > 3) {
        showSummaryNotification(updates.length);
        return;
    }

    for (const update of updates) {
        showSingleNotification(update);
    }
}

function showSummaryNotification(count: number): void {
    const notification = new Notification("Easy Review", {
        body: `${count} pull requests updated in your open inbox sections`,
        tag: "easy-review:inbox-batch",
        icon: "/favicon-inbox.png",
    });
    notification.onclick = () => {
        window.focus();
        window.location.assign("/");
    };
}

function showSingleNotification(update: InboxPullRequestUpdate): void {
    const { pullRequest, summary } = update;
    const [owner = "", repo = ""] = pullRequest.repository.split("/");
    const href = `/pr/${owner}/${repo}/${pullRequest.number}`;

    const notification = new Notification(`${pullRequest.repository}#${pullRequest.number}`, {
        body: `${summary}: ${pullRequest.title}`,
        tag: pullRequest.key,
        icon: "/favicon-inbox.png",
    });

    notification.onclick = () => {
        window.focus();
        window.location.assign(href);
    };
}
