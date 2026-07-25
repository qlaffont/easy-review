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

export type Label = {
    name: string;
    /** Six hex digits, without the leading `#`, exactly as GitHub stores it. */
    color: string;
};

/** One entry of the head commit's status rollup: a check run or a legacy commit status. */
export type CheckRun = {
    name: string;
    state: CheckState;
    url: string | null;
};

/** Whether GitHub thinks the branches can still be combined. */
export type MergeableState = "mergeable" | "conflicting" | "unknown";

/** What the overview page needs on top of an Inbox row. */
export type PullRequestDetail = PullRequestSummary & {
    /** Raw markdown, rendered client-side. Empty when the author wrote no description. */
    body: string;
    headSha: string;
    /** Base tip the pull request wants to land on — used to fetch the left side of a file diff. */
    baseSha: string;
    labels: Array<Label>;
    assignees: Array<string>;
    checkRuns: Array<CheckRun>;
    mergeable: MergeableState;
};

export type FileChangeStatus = "added" | "removed" | "modified" | "renamed";

/**
 * Why a file's diff is not shown until the reviewer asks. Classified from the path (generated)
 * or from the blob itself (binary / huge).
 */
export type FileStubReason = "binary" | "huge" | "generated";

/** One entry in the Review Changes file list. Deliberately without patch text. */
export type PullRequestFile = {
    path: string;
    previousPath: string | null;
    status: FileChangeStatus;
    additions: number;
    deletions: number;
    /** Set when the path alone is enough to refuse an automatic load. */
    stub: FileStubReason | null;
};

export type DiffLineKind = "context" | "add" | "del" | "hunk";

export type DiffLine = {
    kind: DiffLineKind;
    text: string;
    oldNumber: number | null;
    newNumber: number | null;
};

/** The body of one file, fetched only when that file is opened. */
export type FileDiff = {
    path: string;
    lines: Array<DiffLine>;
    /** True when the rendered lines were cut short of the full change. */
    truncated: boolean;
    /** Present when the load stopped short of producing lines (binary, huge without force, …). */
    stub: FileStubReason | null;
};

/** What GitHub receives when the staged review is submitted. */
export type ReviewEvent = "comment" | "approve" | "request-changes";

/** One side of a diff line, matching GitHub's pull review comment API. */
export type DiffSide = "LEFT" | "RIGHT";

/** A line comment that lives only in this browser until submit. */
export type PendingLineComment = {
    /** Stable for the life of the draft — used as the React key and for edits/removals. */
    id: string;
    path: string;
    line: number;
    side: DiffSide;
    body: string;
};

/**
 * Everything the reviewer has staged for one pull request. Keyed and persisted with the head
 * SHA so a push that moves the tip can invalidate comments aimed at vanished lines.
 */
export type ReviewDraft = {
    repository: string;
    number: number;
    headSha: string;
    event: ReviewEvent;
    /** Optional summary posted with the review itself. */
    body: string;
    comments: Array<PendingLineComment>;
    /**
     * Set when the live head no longer matches `headSha`. The draft is kept so the reviewer can
     * read it, but submit is blocked until they discard or the session rebuilds against the new tip.
     */
    stale: boolean;
};

export type ReviewThreadComment = {
    id: string;
    author: string;
    body: string;
    createdAt: string;
};

/** An existing conversation on the diff, loaded so the reviewer can reply in-product. */
export type ReviewThread = {
    id: string;
    path: string;
    line: number | null;
    side: DiffSide | null;
    isResolved: boolean;
    comments: Array<ReviewThreadComment>;
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
