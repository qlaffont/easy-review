import type { EasyReviewSession } from "#/lib/session/session.ts";
import type { PullRequestState } from "#/lib/session/types.ts";

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

export type ActionContext = {
    session: EasyReviewSession;
    target: ActionTarget | null;
    openRepoPicker: () => void;
    goToInbox: () => void;
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
    when: (context: ActionContext) => boolean;
    run: (context: ActionContext) => void | Promise<void>;
};

function hasOpenTarget(context: ActionContext): context is ActionContext & { target: ActionTarget } {
    return context.target !== null && context.target.state === "open";
}

function hasTarget(context: ActionContext): context is ActionContext & { target: ActionTarget } {
    return context.target !== null;
}

/** Every command the palette (and later chords) can discover. */
export const APP_ACTIONS: ReadonlyArray<AppAction> = [
    {
        id: "nav.inbox",
        label: "Go to Inbox",
        group: "Navigation",
        keywords: ["home", "triage"],
        when: () => true,
        run: (context) => {
            context.goToInbox();
        },
    },
    {
        id: "nav.open-selected",
        label: "Open selected pull request",
        group: "Navigation",
        keywords: ["enter", "open"],
        when: hasTarget,
        run: (context) => {
            if (!context.target) return;
            context.openPullRequest(context.target.repository, context.target.number);
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
        when: () => true,
        run: async (context) => {
            await context.session.refreshInbox();
        },
    },
    {
        id: "inbox.choose-repos",
        label: "Choose repositories…",
        group: "Inbox",
        keywords: ["allowlist", "repos"],
        when: () => true,
        run: (context) => {
            context.openRepoPicker();
        },
    },
    {
        id: "copy.pr-url",
        label: "Copy pull request URL",
        group: "Clipboard",
        keywords: ["link"],
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.url);
        },
    },
    {
        id: "copy.pr-title",
        label: "Copy pull request title",
        group: "Clipboard",
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.title);
        },
    },
    {
        id: "copy.branch",
        label: "Copy head branch name",
        group: "Clipboard",
        keywords: ["ref"],
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.copyText(context.target.headRefName);
        },
    },
    {
        id: "copy.checkout",
        label: "Copy gh pr checkout command",
        group: "Clipboard",
        keywords: ["clone", "checkout"],
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
        when: hasTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.session.refreshPullRequest(context.target.repository, context.target.number);
        },
    },
    {
        id: "pr.ready-for-review",
        label: "Mark ready for review",
        group: "Pull request",
        when: (context) => hasOpenTarget(context) && context.target.isDraft,
        run: async (context) => {
            if (!context.target) return;
            await context.session.setPullRequestDraft(context.target.repository, context.target.number, false);
        },
    },
    {
        id: "pr.convert-to-draft",
        label: "Convert to draft",
        group: "Pull request",
        when: (context) => hasOpenTarget(context) && !context.target.isDraft,
        run: async (context) => {
            if (!context.target) return;
            await context.session.setPullRequestDraft(context.target.repository, context.target.number, true);
        },
    },
    {
        id: "pr.close",
        label: "Close pull request",
        group: "Pull request",
        when: hasOpenTarget,
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Close ${context.target.repository}#${context.target.number}?`)) {
                return;
            }
            await context.session.closePullRequest(context.target.repository, context.target.number);
        },
    },
    {
        id: "pr.merge-squash",
        label: "Merge pull request (squash)",
        group: "Pull request",
        keywords: ["ship"],
        when: hasOpenTarget,
        run: async (context) => {
            if (!context.target) return;
            if (!context.confirm(`Squash-merge ${context.target.repository}#${context.target.number}?`)) {
                return;
            }
            await context.session.mergePullRequest(context.target.repository, context.target.number, "squash");
        },
    },
    {
        id: "pr.submit-comment",
        label: "Submit staged review as Comment",
        group: "Pull request",
        when: hasOpenTarget,
        run: async (context) => {
            if (!context.target) return;
            await context.session.setReviewEvent(context.target.repository, context.target.number, "comment");
            await context.session.submitReview(context.target.repository, context.target.number);
        },
    },
];

export function availableActions(context: ActionContext): Array<AppAction> {
    return APP_ACTIONS.filter((action) => action.when(context));
}

export function findAction(id: string): AppAction | undefined {
    return APP_ACTIONS.find((action) => action.id === id);
}
