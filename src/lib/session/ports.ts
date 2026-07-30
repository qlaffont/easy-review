import type { SuggestionChange } from "#/lib/session/apply-suggestion.ts";
import type {
    FileDiff,
    MergeMethod,
    MergePullRequestOptions,
    PendingLineComment,
    PullRequestComment,
    PullRequestCommit,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    PullRequestTimelineItem,
    ReactionContent,
    Repository,
    RepositoryLabel,
    RepositoryUser,
    ReviewEvent,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

export type GithubViewer = {
    login: string;
    name: string | null;
    avatarUrl: string | null;
};

export type InboxPullRequestPageInfo = {
    hasNextPage: boolean;
    endCursor: string | null;
};

export type InboxPullRequestPagination = {
    open: InboxPullRequestPageInfo;
    merged: InboxPullRequestPageInfo;
};

export type ListPullRequestsOptions = {
    /** Per-repo cursors returned by a previous inbox fetch. */
    cursors?: Readonly<Record<string, Partial<{ open: string; merged: string }>>>;
    /** Which PR states to fetch. Defaults to both open and merged. */
    states?: ReadonlyArray<"open" | "merged">;
};

export type ListPullRequestsResult = {
    pullRequests: Array<PullRequestSummary>;
    pagination: Record<string, Partial<InboxPullRequestPagination>>;
};

export type FetchSectionPullRequestsResult = {
    pullRequests: Array<PullRequestSummary>;
    totalCount: number;
    pageInfo: InboxPullRequestPageInfo;
};

export type GetFileDiffOptions = {
    /** Skip the huge / generated stubs and fetch the blob anyway. Binary still refuses. */
    force?: boolean;
    /** Path on the base side when the file was renamed; defaults to `path`. */
    previousPath?: string | null;
    /**
     * When both are set, diff these commits instead of the pull request’s base…head.
     * Used by the Files changed “Changes from” range picker.
     */
    baseOid?: string;
    headOid?: string;
};

/**
 * Everything Easy Review needs from GitHub. Implemented by the browser HTTP adapter in
 * production and by an in-memory double in tests. Every method takes the token explicitly so
 * the client itself never holds credentials.
 */
export type GithubClient = {
    getViewer(token: string): Promise<GithubViewer>;
    /** Every repository the token can see, most recently pushed first. */
    listRepositories(token: string): Promise<Array<Repository>>;
    /** Open and recently merged pull requests across the given repositories, in one batch. */
    listPullRequests(
        token: string,
        repositories: ReadonlyArray<string>,
        options?: ListPullRequestsOptions,
    ): Promise<ListPullRequestsResult>;
    /**
     * Search pull requests in the given repositories (GitHub `search` + `repo:` qualifiers).
     * Used by the command palette when no session action matches the query.
     */
    searchPullRequests(
        token: string,
        input: {
            query: string;
            /** Restrict to these `owner/name` repositories. Empty → no results. */
            repositories: ReadonlyArray<string>;
            /** Cap results (GitHub max 100 per page). */
            limit?: number;
        },
    ): Promise<Array<PullRequestSummary>>;
    /**
     * Count pull requests matching a GitHub search query in the given repositories.
     * Uses `search.issueCount` — accurate without loading every row.
     */
    countPullRequests(
        token: string,
        input: {
            query: string;
            repositories: ReadonlyArray<string>;
        },
    ): Promise<number>;
    /**
     * Pull requests for one inbox section: rows, total count, and search pagination in one call.
     * Query must come from {@link sectionFilterToSearchQuery}; results are sorted by last updated.
     */
    fetchSectionPullRequests(
        token: string,
        input: {
            query: string;
            repositories: ReadonlyArray<string>;
            limit?: number;
            after?: string | null;
        },
    ): Promise<FetchSectionPullRequestsResult>;
    /**
     * Pull requests in other repositories that share exact head + base ref names.
     * Uses GitHub search (`head:` / `base:`) so open and merged siblings are found
     * regardless of age. Closed pull requests never match.
     */
    listRelatedPullRequests(
        token: string,
        input: {
            repositories: ReadonlyArray<string>;
            headRefName: string;
            baseRefName: string;
        },
    ): Promise<Array<PullRequestSummary>>;
    /**
     * Every pull request in one repository plus its default branch — used to infer stack-less
     * dependency chains from `baseRefName` / `headRefName` alone.
     */
    listRepositoryStackIndex(
        token: string,
        repository: string,
    ): Promise<{ defaultBranch: string | null; pullRequests: Array<PullRequestSummary> }>;
    /** One pull request in full. Throws a `not-found` error when the session cannot see it. */
    getPullRequest(token: string, repository: string, number: number): Promise<PullRequestDetail>;
    /** Users who can be assigned (and usually requested as reviewers) on the repository. */
    listRepositoryAssignees(token: string, repository: string): Promise<Array<RepositoryUser>>;
    /** Labels defined on the repository. */
    listRepositoryLabels(token: string, repository: string): Promise<Array<RepositoryLabel>>;
    /** Changed paths only — never the patch text. */
    listPullRequestFiles(token: string, repository: string, number: number): Promise<Array<PullRequestFile>>;
    /**
     * Files changed between two commits (`base...head`), same shape as the PR file list.
     * Used to isolate a commit range on the Files changed tab.
     */
    listComparedFiles(
        token: string,
        repository: string,
        baseOid: string,
        headOid: string,
    ): Promise<Array<PullRequestFile>>;
    /** One file's diff. Callers open a file; this must not pull the rest of the change set. */
    getPullRequestFileDiff(
        token: string,
        repository: string,
        number: number,
        path: string,
        options?: GetFileDiffOptions,
    ): Promise<FileDiff>;
    /** Open review threads on the pull request, oldest first within each thread. */
    listReviewThreads(token: string, repository: string, number: number): Promise<Array<ReviewThread>>;
    /** Conversation comments on the pull request (issue comments), oldest first. */
    listPullRequestComments(token: string, repository: string, number: number): Promise<Array<PullRequestComment>>;
    /** Full conversation timeline (commits, assignments, renames, comments, …), oldest first. */
    listPullRequestTimeline(token: string, repository: string, number: number): Promise<Array<PullRequestTimelineItem>>;
    /** Commits on the pull request, oldest first. */
    listPullRequestCommits(token: string, repository: string, number: number): Promise<Array<PullRequestCommit>>;
    /** Post a conversation comment (not a review / line comment). */
    addPullRequestComment(token: string, repository: string, number: number, body: string): Promise<PullRequestComment>;
    /** Publish one review that carries every pending line comment. */
    submitReview(
        token: string,
        input: {
            repository: string;
            number: number;
            headSha: string;
            event: ReviewEvent;
            body: string;
            comments: ReadonlyArray<Pick<PendingLineComment, "path" | "line" | "side" | "body">>;
        },
    ): Promise<void>;
    /** Reply inside an existing thread. `threadId` is the GraphQL node id. */
    replyToReviewThread(token: string, threadId: string, body: string): Promise<ReviewThreadComment>;
    /** Resolve or unresolve a review thread. */
    setReviewThreadResolved(token: string, threadId: string, resolved: boolean): Promise<void>;
    /** Convert to draft (`true`) or mark ready for review (`false`). */
    setPullRequestDraft(token: string, repository: string, number: number, isDraft: boolean): Promise<void>;
    /** Mark a changed file as viewed or unviewed for the signed-in reviewer on GitHub. */
    setPullRequestFileViewed(
        token: string,
        repository: string,
        number: number,
        path: string,
        viewed: boolean,
    ): Promise<void>;
    /** Replace the pull request's labels with exactly these names. */
    setPullRequestLabels(
        token: string,
        repository: string,
        number: number,
        labels: ReadonlyArray<string>,
    ): Promise<void>;
    /** Replace the pull request's assignees with exactly these logins. */
    setPullRequestAssignees(
        token: string,
        repository: string,
        number: number,
        assignees: ReadonlyArray<string>,
    ): Promise<void>;
    /** Ask these logins for a review (idempotent for already-requested logins). */
    requestReviewers(
        token: string,
        repository: string,
        number: number,
        reviewers: ReadonlyArray<string>,
    ): Promise<void>;
    /** Drop outstanding review requests for these logins. */
    removeReviewers(token: string, repository: string, number: number, reviewers: ReadonlyArray<string>): Promise<void>;
    /** Remove then re-add review requests so GitHub pings the reviewers again. */
    reRequestReview(token: string, repository: string, number: number, reviewers: ReadonlyArray<string>): Promise<void>;
    /** Dismiss an approving / changes-requested review (requires dismiss permission on protected branches). */
    dismissReview(token: string, repository: string, number: number, reviewId: number, message: string): Promise<void>;
    /** Replace the pull request description body. */
    updatePullRequestBody(token: string, repository: string, number: number, body: string): Promise<void>;
    /**
     * Apply one or more review suggestions as a single commit on the PR head branch
     * (GitHub “Commit suggestion” / batch apply).
     */
    applySuggestions(
        token: string,
        input: {
            repository: string;
            number: number;
            headRefName: string;
            headSha: string;
            message: string;
            changes: ReadonlyArray<SuggestionChange>;
        },
    ): Promise<void>;
    /** Update the pull request title and/or base branch. */
    updatePullRequest(
        token: string,
        repository: string,
        number: number,
        input: { title?: string; base?: string },
    ): Promise<void>;
    /** Branch names in the repository (for base-branch editing). */
    listRepositoryBranches(token: string, repository: string): Promise<Array<string>>;
    /** Add a reaction to the PR description (issue). Returns the new reaction id. */
    createIssueReaction(token: string, repository: string, number: number, content: ReactionContent): Promise<number>;
    /** Remove the viewer's reaction from the PR description. */
    deleteIssueReaction(token: string, repository: string, number: number, reactionId: number): Promise<void>;
    /** Find the viewer's reaction id for a content on the PR description, if any. */
    findIssueReactionId(
        token: string,
        repository: string,
        number: number,
        content: ReactionContent,
        viewerLogin: string,
    ): Promise<number | null>;
    /** Add a reaction to an issue comment. */
    createIssueCommentReaction(
        token: string,
        repository: string,
        commentId: number,
        content: ReactionContent,
    ): Promise<number>;
    /** Remove a reaction from an issue comment. */
    deleteIssueCommentReaction(token: string, repository: string, commentId: number, reactionId: number): Promise<void>;
    /** Find the viewer's reaction id on an issue comment. */
    findIssueCommentReactionId(
        token: string,
        repository: string,
        commentId: number,
        content: ReactionContent,
        viewerLogin: string,
    ): Promise<number | null>;
    /** Add a reaction to a pull request review comment (diff thread). */
    createReviewCommentReaction(
        token: string,
        repository: string,
        commentId: number,
        content: ReactionContent,
    ): Promise<number>;
    /** Remove a reaction from a pull request review comment. */
    deleteReviewCommentReaction(
        token: string,
        repository: string,
        commentId: number,
        reactionId: number,
    ): Promise<void>;
    /** Find the viewer's reaction id on a pull request review comment. */
    findReviewCommentReactionId(
        token: string,
        repository: string,
        commentId: number,
        content: ReactionContent,
        viewerLogin: string,
    ): Promise<number | null>;
    /** Merge an open, mergeable pull request. */
    mergePullRequest(
        token: string,
        repository: string,
        number: number,
        method: MergeMethod,
        options?: MergePullRequestOptions,
    ): Promise<void>;
    /** Close an open pull request without merging. */
    closePullRequest(token: string, repository: string, number: number): Promise<void>;
    /**
     * Upload an image/video for a PR comment composer. Stores the file on a hidden git ref
     * (`refs/uploads/pr/{number}`) so it never lands on the PR branch, then returns a raw blob URL.
     */
    uploadPullRequestMedia(
        token: string,
        input: {
            repository: string;
            number: number;
            fileName: string;
            contentType: string;
            bytes: Uint8Array;
        },
    ): Promise<{ url: string; markdown: string }>;
    /**
     * Resolve a bare `user-attachments` URL to a short-lived signed CDN URL via GitHub’s
     * markdown API (same path github.com uses to embed private images/videos).
     */
    resolveUserAttachment(
        token: string,
        repository: string,
        attachmentUrl: string,
    ): Promise<{ kind: "image" | "video"; src: string; name?: string } | null>;
    /**
     * Resolve Easy Review–uploaded `blob/<sha>/…?raw=true` media via the Contents API
     * (`download_url` or inline base64) so private-repo previews can render without cookies.
     */
    resolveRepoBlobMedia(
        token: string,
        mediaUrl: string,
    ): Promise<{ kind: "image" | "video"; src: string; name?: string } | null>;
};

/** Browser persistence, narrowed to what the session needs so IndexedDB can replace it later. */
export type KeyValueStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
};
