import { inboxOpensInEasyReview } from "#/lib/inbox-preferences.ts";

type InboxPullRequestLink = {
    repository: string;
    number: number;
    url: string;
};

type NavigateToPullRequest = (repository: string, number: number) => void;

/** Open a pull request from the inbox — GitHub by default, Easy Review when the setting is on. */
export function openInboxPullRequest(
    pullRequest: InboxPullRequestLink,
    navigateToPullRequest: NavigateToPullRequest,
): void {
    if (inboxOpensInEasyReview()) {
        navigateToPullRequest(pullRequest.repository, pullRequest.number);
        return;
    }

    window.open(pullRequest.url, "_blank", "noopener,noreferrer");
}

function inboxPullRequestHref(pullRequest: InboxPullRequestLink): string {
    if (!inboxOpensInEasyReview()) {
        return pullRequest.url;
    }

    const [owner = "", repo = ""] = pullRequest.repository.split("/");
    return `/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${pullRequest.number}`;
}

/**
 * Open each pull request in its own tab — GitHub by default, Easy Review when the setting is on.
 *
 * Browsers allow one tab per click unless the site may show pop-ups, so the rest can be refused.
 * `noopener` would make `window.open` return null even on success and hide that, so the opener
 * link is cut by hand before the tab navigates away from its blank page.
 */
export function openInboxPullRequestsInTabs(pullRequests: ReadonlyArray<InboxPullRequestLink>): { blocked: number } {
    let blocked = 0;

    for (const pullRequest of pullRequests) {
        const tab = window.open("about:blank", "_blank");
        if (!tab) {
            blocked += 1;
            continue;
        }

        tab.opener = null;
        tab.location.href = inboxPullRequestHref(pullRequest);
    }

    return { blocked };
}
