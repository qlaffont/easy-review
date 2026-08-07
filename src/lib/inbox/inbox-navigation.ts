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
