import { useEffect } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

/** Each name has a `/favicon-<name>.png` and `.svg` in `public/`. */
export type TabFavicon = "inbox" | "inbox-new" | "pr-open" | "pr-draft" | "pr-merged" | "pr-closed";

export function pullRequestFavicon(pullRequest: Pick<PullRequestSummary, "state" | "isDraft">): TabFavicon {
    if (pullRequest.state === "merged") {
        return "pr-merged";
    }
    if (pullRequest.state === "closed") {
        return "pr-closed";
    }
    return pullRequest.isDraft ? "pr-draft" : "pr-open";
}

/**
 * Swap the icon links declared in the root route. Their hrefs are only rewritten in the browser,
 * so the server-rendered head that crawlers and link unfurls read keeps the Inbox icon.
 */
export function applyTabFavicon(icon: TabFavicon): void {
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
        const extension = link.type === "image/svg+xml" ? "svg" : "png";
        link.href = `/favicon-${icon}.${extension}`;
    }
}

/** Show this icon in the tab while mounted, then fall back to the Inbox icon. `null` leaves the tab alone. */
export function useTabFavicon(icon: TabFavicon | null): void {
    useEffect(() => {
        if (!icon) {
            return;
        }
        applyTabFavicon(icon);
        return () => applyTabFavicon("inbox");
    }, [icon]);
}
