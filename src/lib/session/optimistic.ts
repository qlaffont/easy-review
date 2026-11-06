import type {
    DiffSide,
    PullRequestDetail,
    PullRequestTimelineItem,
    ReviewEvent,
    ReviewState,
    ReviewThread,
    ReviewThreadComment,
} from "#/lib/session/types.ts";

/** Who the UI shows as the author of something GitHub has not confirmed yet. */
type OptimisticAuthor = { login: string; avatarUrl: string | null };

function optimisticId(): string {
    return `optimistic-${crypto.randomUUID()}`;
}

export function optimisticThreadId(pendingCommentId: string): string {
    return `optimistic-thread-${pendingCommentId}`;
}

function reviewStateFor(event: ReviewEvent): ReviewState {
    if (event === "approve") {
        return "approved";
    }
    return event === "request-changes" ? "changes-requested" : "commented";
}

export function optimisticThreadComment(author: OptimisticAuthor, body: string): ReviewThreadComment {
    return {
        id: optimisticId(),
        databaseId: 0,
        author: author.login,
        authorAvatarUrl: author.avatarUrl,
        body,
        createdAt: new Date().toISOString(),
        url: "",
        reactionGroups: [],
        sending: true,
    };
}

export function optimisticThread(
    author: OptimisticAuthor,
    input: { id?: string; path: string; line: number; side: DiffSide; body: string },
): ReviewThread {
    return {
        id: input.id ?? optimisticId(),
        path: input.path,
        startLine: null,
        line: input.line,
        side: input.side,
        isResolved: false,
        isOutdated: false,
        diffHunk: null,
        comments: [optimisticThreadComment(author, input.body)],
    };
}

/** A thread that only exists locally has no GitHub id to reply to or resolve yet. */
export function isThreadSending(thread: ReviewThread): boolean {
    return thread.comments[0]?.sending === true;
}

export function optimisticIssueComment(
    author: OptimisticAuthor,
    body: string,
): Extract<PullRequestTimelineItem, { kind: "comment" }> {
    return {
        kind: "comment",
        id: optimisticId(),
        databaseId: 0,
        author: author.login,
        authorAvatarUrl: author.avatarUrl,
        body,
        createdAt: new Date().toISOString(),
        url: "",
        lastEditedAt: null,
        editor: null,
        editCount: 0,
        edits: [],
        reactionGroups: [],
        sending: true,
    };
}

export function optimisticReviewItem(
    author: OptimisticAuthor,
    event: ReviewEvent,
    body: string,
): Extract<PullRequestTimelineItem, { kind: "review" }> {
    return {
        kind: "review",
        id: optimisticId(),
        createdAt: new Date().toISOString(),
        author,
        state: reviewStateFor(event),
        body,
        url: "",
        sending: true,
    };
}

/**
 * The viewer's row once their review lands: no longer requested, and showing the new state. A plain
 * comment does not replace an earlier approval or change request, matching `aggregateReviewerStatuses`.
 */
export function withViewerReview(detail: PullRequestDetail, login: string, event: ReviewEvent): PullRequestDetail {
    const existing = detail.reviewers.find((reviewer) => reviewer.login === login);
    const keepsEarlierVerdict = event === "comment" && existing && existing.state !== "commented";
    const reviewer = {
        ...existing,
        login,
        state: keepsEarlierVerdict ? existing.state : reviewStateFor(event),
        reviewId: existing?.reviewId ?? 0,
    };

    return {
        ...detail,
        reviewRequests: detail.reviewRequests.filter((requested) => requested !== login),
        reviewers: existing
            ? detail.reviewers.map((entry) => (entry.login === login ? reviewer : entry))
            : [...detail.reviewers, reviewer],
    };
}
