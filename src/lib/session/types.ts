/** Rolled-up state of the CI attached to the head commit. */
export type CheckState = "none" | "pending" | "success" | "failure";

export type ReviewDecision = "approved" | "changes-requested" | "review-required" | null;

export type ReviewState = "approved" | "changes-requested" | "commented" | "dismissed" | "pending";

export type PullRequestState = "open" | "merged" | "closed";

export type ReviewerStatus = {
    login: string;
    state: ReviewState;
    /** GitHub review database id — required to dismiss the review. */
    reviewId: number;
};

/** Whether GitHub thinks the branches can still be combined. */
export type MergeableState = "mergeable" | "conflicting" | "unknown";

/** GitHub `mergeStateStatus` — whether the PR meets merge requirements (reviews, checks, etc.). */
export type MergeStateStatus =
    | "behind"
    | "blocked"
    | "clean"
    | "dirty"
    | "draft"
    | "has_hooks"
    | "unknown"
    | "unstable";

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
    /** Issue + review comments — GitHub Conversation tab badge (`totalCommentsCount`). */
    commentCount: number;
    /** Whether GitHub can merge head into base — used for inbox conflict signals. */
    mergeable: MergeableState;
    /** Assignees (logins) — needed for section filters. */
    assignees: Array<string>;
    /** Labels on the pull request — needed for section filters. */
    labels: Array<Label>;
};

export type Label = {
    name: string;
    /** Six hex digits, without the leading `#`, exactly as GitHub stores it. */
    color: string;
};

/** A label as listed from the repository (includes description for the picker). */
export type RepositoryLabel = Label & {
    description: string | null;
};

/** A user who can be assigned or asked to review on a repository. */
export type RepositoryUser = {
    login: string;
    name: string | null;
    avatarUrl: string | null;
};

/** One entry of the head commit's status rollup: a check run or a legacy commit status. */
export type CheckRun = {
    name: string;
    state: CheckState;
    url: string | null;
    /** Short status line under the name, e.g. "Failing after 1m" / "Successful in 6s". */
    summary: string | null;
};

/** How GitHub should combine the head into the base when merging. */
export type MergeMethod = "merge" | "squash" | "rebase";

/** Optional squash/merge-commit message overrides passed to GitHub on merge. */
export type MergePullRequestOptions = {
    commitTitle?: string;
    commitMessage?: string;
};

/** GitHub reaction content values used on issues and comments. */
export type ReactionContent = "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";

/** Aggregated reaction counts for a subject (PR description or comment). */
export type ReactionGroup = {
    content: ReactionContent;
    count: number;
    viewerHasReacted: boolean;
};

/** Who last edited a description or comment body (GitHub `editor` / edit history). */
export type ContentEditor = {
    login: string;
    avatarUrl: string | null;
    isBot: boolean;
};

export type ContentEdit = {
    editedAt: string;
    editor: ContentEditor | null;
};

/** What the overview page needs on top of an Inbox row. */
export type PullRequestDetail = PullRequestSummary & {
    /** Raw markdown, rendered client-side. Empty when the author wrote no description. */
    body: string;
    /** When the description was last edited; null if never edited after creation. */
    lastEditedAt: string | null;
    /** Last editor of the description (often a bot like CodeRabbit). */
    editor: ContentEditor | null;
    /** Total edit count from GitHub; may exceed `edits.length`. */
    editCount: number;
    /** Recent body edits, newest first. */
    edits: Array<ContentEdit>;
    /** Reactions on the pull request description (GitHub issue). */
    reactionGroups: Array<ReactionGroup>;
    headSha: string;
    /** Base tip the pull request wants to land on — used to fetch the left side of a file diff. */
    baseSha: string;
    labels: Array<Label>;
    assignees: Array<string>;
    checkRuns: Array<CheckRun>;
    /**
     * GitHub Checks-tab badge: check-run count from suites (excludes legacy commit statuses).
     * Prefer this over `checkRuns.length` — GitHub often omits CheckRun nodes depending on
     * credential permissions (GitHub App permissions / scopes).
     */
    checkCount: number;
    /**
     * From the base branch protection rule. `null` when the base has no (readable) approving-review
     * requirement — never invent a count client-side.
     */
    requiredApprovingReviewCount: number | null;
    /** Merge strategies the repository allows — never offer a method GitHub would reject. */
    allowedMergeMethods: Array<MergeMethod>;
    /** Repo default for the viewer, when GitHub reports one and it is still allowed. */
    defaultMergeMethod: MergeMethod | null;
    /** Commits on the pull request — used for merge-method copy. */
    commitCount: number;
    /** Whether reviews, checks, and other rules allow merging (GitHub merge box). */
    mergeStateStatus: MergeStateStatus;
    /** True when the signed-in viewer may bypass branch rules and merge anyway. */
    viewerCanMergeAsAdmin: boolean;
};

/** One commit on a pull request (the Commits tab list). */
export type PullRequestCommit = {
    oid: string;
    abbreviatedOid: string;
    messageHeadline: string;
    committedAt: string;
    authorLogin: string;
    authorAvatarUrl: string | null;
    url: string;
    checkState: CheckState;
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

export type DiffLineKind = "context" | "add" | "del" | "hunk" | "gap";

/** Collapsed unchanged region between hunks — expand to reveal more context. */
export type DiffGap = {
    /** Stable id of the full equal-run this hole belongs to (used for expand state). */
    id: string;
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
    /** Peel lines from the top of the hole (toward a hunk above). False at file start. */
    expandDown: boolean;
    /** Peel lines from the bottom of the hole (toward a hunk below). False at file end. */
    expandUp: boolean;
};

export type DiffLine = {
    kind: DiffLineKind;
    text: string;
    oldNumber: number | null;
    newNumber: number | null;
    /** Set when `kind === "gap"`. */
    gap?: DiffGap;
};

/** The body of one file, fetched only when that file is opened. */
export type FileDiff = {
    path: string;
    lines: Array<DiffLine>;
    /** True when the rendered lines were cut short of the full change. */
    truncated: boolean;
    /** Present when the load stopped short of producing lines (binary, huge without force, …). */
    stub: FileStubReason | null;
    /**
     * Decoded sides kept so the viewer can rematerialize (expand context, hide whitespace,
     * show full file) without another network round-trip. Null when stubbed.
     */
    beforeText: string | null;
    afterText: string | null;
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
    /** Numeric REST id — required for reaction create/delete. */
    databaseId: number;
    author: string;
    authorAvatarUrl: string | null;
    body: string;
    createdAt: string;
    /** Permalink on GitHub (`…#discussion_r…`). */
    url: string;
    reactionGroups: Array<ReactionGroup>;
};

/** A conversation comment on the pull request (GitHub issue comment), not a diff review. */
export type PullRequestComment = {
    id: string;
    /** Numeric REST id — required for reaction create/delete. */
    databaseId: number;
    author: string;
    authorAvatarUrl: string | null;
    body: string;
    createdAt: string;
    url: string;
    lastEditedAt: string | null;
    editor: ContentEditor | null;
    editCount: number;
    edits: Array<ContentEdit>;
    reactionGroups: Array<ReactionGroup>;
};

type TimelineActor = {
    login: string;
    avatarUrl: string | null;
};

/** Commit signing details from GitHub (`commit.signature`). */
export type CommitSignature = {
    verified: boolean;
    /** GPG key id, SSH fingerprint, or null when the payload did not include one. */
    keyId: string | null;
    signerLogin: string | null;
    signerName: string | null;
    signerAvatarUrl: string | null;
};

/** One entry in the pull request conversation timeline (GitHub `timelineItems`). */
export type PullRequestTimelineItem =
    | ({ kind: "comment" } & PullRequestComment)
    | {
          kind: "commit";
          id: string;
          createdAt: string;
          author: TimelineActor;
          messageHeadline: string;
          oid: string;
          abbreviatedOid: string;
          url: string;
          checkState: CheckState;
          /** Individual jobs behind `checkState` — empty when none, or when the token cannot read Checks. */
          checkRuns: Array<CheckRun>;
          /** Present when GitHub reported a signature; `verified` is true for a valid one. */
          signature: CommitSignature | null;
      }
    | {
          kind: "assigned";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          assignee: string;
      }
    | {
          kind: "unassigned";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          assignee: string;
      }
    | {
          kind: "renamed-title";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          previousTitle: string;
          currentTitle: string;
      }
    | {
          kind: "labeled";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          label: Label;
      }
    | {
          kind: "unlabeled";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          label: Label;
      }
    | {
          kind: "review-requested";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          reviewer: string;
      }
    | {
          kind: "review-request-removed";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          reviewer: string;
      }
    | {
          kind: "ready-for-review";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "convert-to-draft";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "closed";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "reopened";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "merged";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "review";
          id: string;
          createdAt: string;
          author: TimelineActor;
          state: ReviewState;
          body: string;
          url: string;
      }
    | {
          kind: "head-ref-force-pushed";
          id: string;
          createdAt: string;
          actor: TimelineActor;
      }
    | {
          kind: "base-ref-changed";
          id: string;
          createdAt: string;
          actor: TimelineActor;
          previousRefName: string;
          currentRefName: string;
      };

/** An existing conversation on the diff, loaded so the reviewer can reply in-product. */
export type ReviewThread = {
    id: string;
    path: string;
    /** First line of a multi-line comment range (GitHub `startLine`), when set. */
    startLine: number | null;
    line: number | null;
    side: DiffSide | null;
    isResolved: boolean;
    /** True when the commented lines no longer exist on the PR head (GitHub `isOutdated`). */
    isOutdated: boolean;
    /** Unified diff snippet from the first review comment (GitHub `diffHunk`), when available. */
    diffHunk: string | null;
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
