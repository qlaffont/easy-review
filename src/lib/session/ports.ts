import type {
    FileDiff,
    MergeMethod,
    PendingLineComment,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    Repository,
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
    /** One pull request in full. Throws a `not-found` error when the token cannot see it. */
    getPullRequest(token: string, repository: string, number: number): Promise<PullRequestDetail>;
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
