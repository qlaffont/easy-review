/** Rolled-up state of the CI attached to the head commit. */
export type CheckState = "none" | "pending" | "success" | "failure";

export type ReviewDecision = "approved" | "changes-requested" | "review-required" | null;

export type ReviewState = "approved" | "changes-requested" | "commented" | "dismissed" | "pending";

export type PullRequestState = "open" | "merged" | "closed";

export type ReviewerStatus = {
    login: string;
    state: ReviewState;
};

/** Everything an Inbox row needs. Deliberately flat so it can be cached as JSON. */
export type PullRequestSummary = {
    /** `owner/repo#number`, stable across refreshes. */
    key: string;
    repository: string;
    number: number;
    title: string;
    url: string;
    author: string;
    authorAvatarUrl: string | null;
    state: PullRequestState;
    isDraft: boolean;
    createdAt: string;
    updatedAt: string;
    mergedAt: string | null;
    headRefName: string;
    baseRefName: string;
    reviewDecision: ReviewDecision;
    /** Logins with an outstanding review request, including teams by name. */
    reviewRequests: Array<string>;
    reviewers: Array<ReviewerStatus>;
    checks: CheckState;
    additions: number;
    deletions: number;
    changedFiles: number;
    commentCount: number;
};

export type Repository = {
    /** `owner/repo`, the identity Easy Review uses everywhere. */
    nameWithOwner: string;
    owner: string;
    name: string;
    isPrivate: boolean;
    isArchived: boolean;
    /** ISO timestamp of the last push, used to order the picker. */
    pushedAt: string | null;
};
