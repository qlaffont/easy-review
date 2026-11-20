import type { GithubPullRequestStack } from "#/lib/session/types.ts";

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

type OpenAllCandidate = {
    repository: string;
    githubStack?: Pick<GithubPullRequestStack, "number" | "position"> | null;
};

/**
 * Pull requests “Open all” should open, in list order.
 *
 * With `walkStacks`, submitting a review already moves to the next layer above, so each stack
 * keeps only its lowest layer in the list — the others would be duplicate tabs.
 */
export function pullRequestsToOpenAll<T extends OpenAllCandidate>(
    pullRequests: ReadonlyArray<T>,
    { walkStacks }: { walkStacks: boolean },
): Array<T> {
    if (!walkStacks) {
        return [...pullRequests];
    }

    // Stack numbers are only unique within a repository.
    const stackKey = (repository: string, stack: { number: number }) => `${repository}#${stack.number}`;
    const lowestPositionByStack = new Map<string, number>();
    for (const { repository, githubStack } of pullRequests) {
        if (!githubStack) {
            continue;
        }
        const key = stackKey(repository, githubStack);
        const lowest = lowestPositionByStack.get(key);
        if (lowest === undefined || githubStack.position < lowest) {
            lowestPositionByStack.set(key, githubStack.position);
        }
    }

    return pullRequests.filter(
        ({ repository, githubStack }) =>
            !githubStack || lowestPositionByStack.get(stackKey(repository, githubStack)) === githubStack.position,
    );
}
