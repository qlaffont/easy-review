import type { EasyReviewSession } from "#/lib/session/session.ts";
import type { PullRequestDetail, PullRequestState } from "#/lib/session/types.ts";

import { shouldReturnToInboxAfterReviewOrMerge, shouldDeleteHeadBranchOnMerge } from "#/lib/diff-preferences.ts";
import { openInboxPullRequest } from "#/lib/inbox/inbox-navigation.ts";
import { notifyAction, notifyActionWithInboxPrompt } from "#/lib/toast.ts";

/**
 * The pull request the keyboard selection or the open page is focused on. Copy and lifecycle
 * actions read from this rather than scraping the DOM.
 */
export type ActionTarget = {
    repository: string;
    number: number;
    title: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    state: PullRequestState;
};

export type ActionSurface = "inbox" | "pull-request";

export type ActionContext = {
    session: EasyReviewSession;
    /** Which app surface the user is on — gates palette commands to what is relevant there. */
    surface: ActionSurface;
    target: ActionTarget | null;
    /** Full PR detail when on a pull request page — powers merge/review commands. */
    pullRequestDetail: PullRequestDetail | null;
    openRepoPicker: () => void;
    goToInbox: () => void;
    /** Navigate to Inbox and refetch every section from GitHub (after review, merge, etc.). */
    goToInboxFresh: () => void;
    openPullRequest: (repository: string, number: number) => void;
    openReviewChanges: (repository: string, number: number) => void;
    copyText: (text: string) => Promise<void>;
    confirm: (message: string) => boolean;
};

/**
 * A named app action. Ids are stable so chord shortcuts can attach later without renaming.
 * `when` gates visibility in the palette; `run` performs the work.
 */
export type AppAction = {
    id: string;
    label: string;
    group: "Navigation" | "Clipboard" | "Inbox" | "Pull request";
    keywords?: Array<string>;
    /** Displayed in the command palette (e.g. keyboard chord). */
    shortcut?: string;
    when: (context: ActionContext) => boolean;
    run: (context: ActionContext) => void | Promise<void>;
};

function hasOpenTarget(context: ActionContext): context is ActionContext & { target: ActionTarget } {
    return context.target !== null && context.target.state === "open";
}

function hasTarget(context: ActionContext): context is ActionContext & { target: ActionTarget } {
    return context.target !== null;
}

function onInbox(context: ActionContext): boolean {
    return context.surface === "inbox";
}

function onPullRequest(context: ActionContext): boolean {
    return context.surface === "pull-request";
}

function onPullRequestWithDetail(
    context: ActionContext,
): context is ActionContext & { target: ActionTarget; pullRequestDetail: PullRequestDetail } {
    return onPullRequest(context) && hasOpenTarget(context) && context.pullRequestDetail !== null;
}

/** Every command the palette (and later chords) can discover. */
export const APP_ACTIONS: ReadonlyArray<AppAction> = [
    {
        id: "nav.inbox",
        label: "Go to Inbox",
        group: "Navigation",
        keywords: ["home", "triage"],
        shortcut: "Esc",
        when: onPullRequest,
        run: (context) => {
            context.goToInbox();
        },
    },
    {
        id: "nav.open-selected",
        label: "Open selected pull request",
        group: "Navigation",
        keywords: ["enter", "open"],
        shortcut: "Enter",
        when: (context) => onInbox(context) && hasTarget(context),
        run: (context) => {
            if (!context.target) return;
            openInboxPullRequest(context.target, (repository, number) => {
                context.openPullRequest(repository, number);
            });
        },
    },
    {
        id: "nav.review-changes",
        label: "Open Review Changes",
        group: "Navigation",
        keywords: ["diff", "files"],
        when: hasTarget,
        run: (context) => {
            if (!context.target) return;
            context.openReviewChanges(context.target.repository, context.target.number);
        },
    },
    {
        id: "inbox.refresh",
        label: "Refresh Inbox",
        group: "Inbox",
        when: onInbox,
        run: async (context) => {
            await notifyAction(() => context.session.refreshInbox(), {
                loading: "Refreshing inbox…",
                success: "Inbox refreshed",
                error: "Could not refresh the inbox.",
            });
        },
    },
    {
        id: "inbox.choose-repos",
        label: "Choose repositories…",
        group: "Inbox",
        keywords: ["allowlist", "repos"],
        when: onInbox,
        run: (context) => {
            context.openRepoPicker();
        },
    },
    {
        id: "copy.pr-url",
        label: "Copy link to PR",
        group: "Clipboard",
        keywords: ["link", "app"],
        shortcut: "C L",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            const [owner = "", repo = ""] = context.target.repository.split("/");
            const path = `/pr/${owner}/${repo}/${context.target.number}`;
            const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
            await context.copyText(url);
        },
    },
    {
        id: "copy.github-url",
        label: "Copy link to GitHub",
        group: "Clipboard",
        keywords: ["link", "github"],
        shortcut: "C G",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.url);
        },
    },
    {
        id: "copy.pr-title",
        label: "Copy title",
        group: "Clipboard",
        shortcut: "C T",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.title);
        },
    },
    {
        id: "copy.branch",
        label: "Copy PR branch name",
        group: "Clipboard",
        keywords: ["ref"],
        shortcut: "C B",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.headRefName);
        },
    },
    {
        id: "copy.checkout",
        label: "Copy CLI checkout command",
        group: "Clipboard",
        keywords: ["clone", "checkout", "gh"],
        shortcut: "C C",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            const [owner = "", repo = ""] = context.target.repository.split("/");
            await context.copyText(`gh pr checkout ${context.target.number} --repo ${owner}/${repo}`);
        },
    },
    {
        id: "pr.refresh",
        label: "Refresh pull request",
        group: "Pull request",
        keywords: ["reload", "sync"],
        shortcut: "⌘R",
        when: (context) => onPullRequest(context) && hasTarget(context),
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.refreshPullRequest(context.target!.repository, context.target!.number),
                {
                    loading: "Refreshing pull request…",
                    success: "Pull request refreshed",
                    error: "Could not refresh the pull request.",
                },
            );
        },
    },
    {
        id: "pr.ready-for-review",
        label: "Mark ready for review",
        group: "Pull request",
        when: (context) => onPullRequest(context) && hasOpenTarget(context) && context.target.isDraft,
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.setPullRequestDraft(context.target!.repository, context.target!.number, false),
                {
                    loading: "Marking ready for review…",
                    success: "Marked ready for review",
                    error: "Could not update draft status.",
                },
            );
        },
    },
    {
        id: "pr.convert-to-draft",
        label: "Convert to draft",
        group: "Pull request",
        when: (context) => onPullRequest(context) && hasOpenTarget(context) && !context.target.isDraft,
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.setPullRequestDraft(context.target!.repository, context.target!.number, true),
                {
                    loading: "Converting to draft…",
                    success: "Converted to draft",
                    error: "Could not update draft status.",
                },
            );
        },
    },
    {
        id: "pr.close",
        label: "Close pull request",
        group: "Pull request",
        when: (context) => onPullRequest(context) && hasOpenTarget(context),
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Close ${context.target.repository}#${context.target.number}?`)) {
                return;
            }
            await notifyAction(
                () => context.session.closePullRequest(context.target!.repository, context.target!.number),
                {
                    loading: "Closing pull request…",
                    success: "Pull request closed",
                    error: "Could not close the pull request.",
                },
            );
        },
    },
    {
        id: "pr.reopen",
        label: "Reopen pull request",
        group: "Pull request",
        when: (context) => onPullRequest(context) && hasTarget(context) && context.target.state === "closed",
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.reopenPullRequest(context.target!.repository, context.target!.number),
                {
                    loading: "Reopening pull request…",
                    success: "Pull request reopened",
                    error: "Could not reopen the pull request.",
                },
            );
        },
    },
    {
        id: "pr.update-branch",
        label: "Update branch",
        group: "Pull request",
        keywords: ["rebase", "merge base"],
        when: (context) => onPullRequestWithDetail(context) && context.pullRequestDetail.viewerCanUpdateBranch,
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.updatePullRequestBranch(context.target!.repository, context.target!.number),
                {
                    loading: "Updating branch…",
                    success: "Branch updated",
                    error: "Could not update the branch.",
                },
            );
        },
    },
    {
        id: "pr.approve",
        label: "Approve pull request",
        group: "Pull request",
        keywords: ["review", "lgtm"],
        when: onPullRequestWithDetail,
        run: async (context) => {
            if (!context.target) return;
            await notifyActionWithInboxPrompt(
                async () => {
                    await context.session.setReviewEvent(context.target!.repository, context.target!.number, "approve");
                    await context.session.submitReview(context.target!.repository, context.target!.number);
                },
                {
                    loading: "Submitting approval…",
                    success: "Pull request approved",
                    error: "Could not approve the pull request.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
    {
        id: "pr.request-changes",
        label: "Request changes",
        group: "Pull request",
        keywords: ["review", "block"],
        when: onPullRequestWithDetail,
        run: async (context) => {
            if (!context.target) return;
            await notifyActionWithInboxPrompt(
                async () => {
                    await context.session.setReviewEvent(
                        context.target!.repository,
                        context.target!.number,
                        "request-changes",
                    );
                    await context.session.submitReview(context.target!.repository, context.target!.number);
                },
                {
                    loading: "Submitting review…",
                    success: "Changes requested",
                    error: "Could not submit the review.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
    {
        id: "pr.merge-merge",
        label: "Merge pull request (merge commit)",
        group: "Pull request",
        keywords: ["ship"],
        when: (context) =>
            onPullRequestWithDetail(context) && context.pullRequestDetail.allowedMergeMethods.includes("merge"),
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Merge ${context.target.repository}#${context.target.number} with a merge commit?`)) {
                return;
            }
            await notifyActionWithInboxPrompt(
                () =>
                    context.session.mergePullRequest(context.target!.repository, context.target!.number, "merge", {
                        deleteHeadBranch: shouldDeleteHeadBranchOnMerge(),
                    }),
                {
                    loading: "Merging pull request…",
                    success: "Pull request merged",
                    error: "Could not merge the pull request.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
    {
        id: "pr.merge-rebase",
        label: "Merge pull request (rebase)",
        group: "Pull request",
        keywords: ["ship", "rebase"],
        when: (context) =>
            onPullRequestWithDetail(context) && context.pullRequestDetail.allowedMergeMethods.includes("rebase"),
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Rebase-merge ${context.target.repository}#${context.target.number}?`)) {
                return;
            }
            await notifyActionWithInboxPrompt(
                () =>
                    context.session.mergePullRequest(context.target!.repository, context.target!.number, "rebase", {
                        deleteHeadBranch: shouldDeleteHeadBranchOnMerge(),
                    }),
                {
                    loading: "Merging pull request…",
                    success: "Pull request merged",
                    error: "Could not merge the pull request.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
    {
        id: "pr.auto-merge-squash",
        label: "Enable auto-merge (squash)",
        group: "Pull request",
        when: (context) =>
            onPullRequestWithDetail(context) &&
            !context.pullRequestDetail.autoMergeEnabled &&
            context.pullRequestDetail.allowedMergeMethods.includes("squash"),
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () =>
                    context.session.enablePullRequestAutoMerge(
                        context.target!.repository,
                        context.target!.number,
                        "squash",
                    ),
                {
                    loading: "Enabling auto-merge…",
                    success: "Auto-merge enabled",
                    error: "Could not enable auto-merge.",
                },
            );
        },
    },
    {
        id: "pr.cancel-auto-merge",
        label: "Cancel auto-merge",
        group: "Pull request",
        when: (context) => onPullRequestWithDetail(context) && context.pullRequestDetail.autoMergeEnabled,
        run: async (context) => {
            if (!context.target) return;
            await notifyAction(
                () => context.session.disablePullRequestAutoMerge(context.target!.repository, context.target!.number),
                {
                    loading: "Cancelling auto-merge…",
                    success: "Auto-merge cancelled",
                    error: "Could not cancel auto-merge.",
                },
            );
        },
    },
    {
        id: "pr.merge-squash",
        label: "Merge pull request (squash)",
        group: "Pull request",
        keywords: ["ship"],
        when: (context) => onPullRequest(context) && hasOpenTarget(context),
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Squash-merge ${context.target.repository}#${context.target.number}?`)) {
                return;
            }
            await notifyActionWithInboxPrompt(
                () =>
                    context.session.mergePullRequest(context.target!.repository, context.target!.number, "squash", {
                        deleteHeadBranch: shouldDeleteHeadBranchOnMerge(),
                    }),
                {
                    loading: "Merging pull request…",
                    success: "Pull request merged",
                    error: "Could not merge the pull request.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
    {
        id: "pr.submit-comment",
        label: "Submit staged review as Comment",
        group: "Pull request",
        when: (context) => onPullRequest(context) && hasOpenTarget(context),
        run: async (context) => {
            if (!context.target) return;
            await notifyActionWithInboxPrompt(
                async () => {
                    await context.session.setReviewEvent(context.target!.repository, context.target!.number, "comment");
                    await context.session.submitReview(context.target!.repository, context.target!.number);
                },
                {
                    loading: "Submitting review…",
                    success: "Review submitted",
                    error: "Could not submit the review.",
                },
                {
                    returnToInbox: shouldReturnToInboxAfterReviewOrMerge(),
                    onGoToInbox: context.goToInboxFresh,
                },
            );
        },
    },
];

export function availableActions(context: ActionContext): Array<AppAction> {
    return APP_ACTIONS.filter((action) => action.when(context));
}

export function findAction(id: string): AppAction | undefined {
    return APP_ACTIONS.find((action) => action.id === id);
}
