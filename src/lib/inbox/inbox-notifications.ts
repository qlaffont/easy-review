import { inboxPreferencesEnabled } from "#/lib/inbox-preferences.ts";
import { playInboxChime } from "#/lib/inbox/inbox-chime.ts";

export type PullRequestNotification = {
    repository: string;
    number: number;
    key: string;
    title: string;
    sectionLabel: string;
};

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

/**
 * Whether the user is looking at this tab. A visible window can still sit behind or
 * beside the app in use, so visibility alone is not enough.
 */
export function isTabAttended(): boolean {
    return document.visibilityState === "visible" && document.hasFocus();
}

/** Show desktop notifications and play the chime for new pull requests. No-op when disabled, denied, or the tab is attended. */
export function showNewPullRequestNotifications(pullRequests: ReadonlyArray<PullRequestNotification>): void {
    if (pullRequests.length === 0) {
        return;
    }
    if (!inboxPreferencesEnabled()) {
        return;
    }
    if (isTabAttended()) {
        return;
    }
    if (notificationPermission() !== "granted") {
        return;
    }

    void playInboxChime(pullRequests.map((pullRequest) => pullRequest.key));

    if (pullRequests.length > 3) {
        showSummaryNotification(pullRequests.length);
        return;
    }

    for (const pullRequest of pullRequests) {
        showSingleNotification(pullRequest);
    }
}

function showSummaryNotification(count: number): void {
    const notification = new Notification("Easy Review", {
        body: `${count} new pull requests in your inbox`,
        tag: "easy-review:inbox-batch",
        icon: "/favicon-inbox.png",
    });
    notification.onclick = () => {
        window.focus();
        window.location.assign("/");
    };
}

function showSingleNotification(pullRequest: PullRequestNotification): void {
    const [owner = "", repo = ""] = pullRequest.repository.split("/");
    const href = `/pr/${owner}/${repo}/${pullRequest.number}`;

    const notification = new Notification(`${pullRequest.repository}#${pullRequest.number}`, {
        body: `New in ${pullRequest.sectionLabel}: ${pullRequest.title}`,
        tag: pullRequest.key,
        icon: "/favicon-inbox.png",
    });

    notification.onclick = () => {
        window.focus();
        window.location.assign(href);
    };
}
