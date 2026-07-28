import type { SuggestionChange } from "#/lib/session/apply-suggestion.ts";
import type {
    FileDiff,
    MergeMethod,
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

export type GetFileDiffOptions = {
    /** Skip the huge / generated stubs and fetch the blob anyway. Binary still refuses. */
    force?: boolean;
    /** Path on the base side when the file was renamed; defaults to `path`. */
    previousPath?: string | null;
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
    listPullRequests(token: string, repositories: ReadonlyArray<string>): Promise<Array<PullRequestSummary>>;
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
    /** One pull request in full. Throws a `not-found` error when the session cannot see it. */
    getPullRequest(token: string, repository: string, number: number): Promise<PullRequestDetail>;
    /** Users who can be assigned (and usually requested as reviewers) on the repository. */
    listRepositoryAssignees(token: string, repository: string): Promise<Array<RepositoryUser>>;
    /** Labels defined on the repository. */
    listRepositoryLabels(token: string, repository: string): Promise<Array<RepositoryLabel>>;
    /** Changed paths only — never the patch text. */
    listPullRequestFiles(token: string, repository: string, number: number): Promise<Array<PullRequestFile>>;
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
    /** Merge an open, mergeable pull request. */
    mergePullRequest(token: string, repository: string, number: number, method: MergeMethod): Promise<void>;
    /** Close an open pull request without merging. */
    closePullRequest(token: string, repository: string, number: number): Promise<void>;
};

/** Browser persistence, narrowed to what the session needs so IndexedDB can replace it later. */
export type KeyValueStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
};
