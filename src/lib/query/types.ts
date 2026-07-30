import type { SessionError } from "#/lib/session/errors.ts";
import type { InboxSectionId } from "#/lib/session/inbox-sections.ts";
import type { InboxPullRequestPageInfo } from "#/lib/session/ports.ts";
import type { ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import type {
    FileDiff,
    PullRequestCommit,
    PullRequestDetail,
    PullRequestFile,
    PullRequestSummary,
    PullRequestTimelineItem,
    Repository,
    RepositoryLabel,
    RepositoryUser,
    ReviewThread,
} from "#/lib/session/types.ts";

export type InboxQueryData = {
    pullRequests: Array<PullRequestSummary>;
    sectionPullRequests: Record<string, Array<PullRequestSummary>>;
    sectionCounts: Record<string, number>;
    sectionPagination: Record<string, InboxPullRequestPageInfo>;
    lastLoadedAt: string | null;
};

export type RepositoriesQueryData = {
    available: Array<Repository>;
    lastLoadedAt: string | null;
};

export type PullRequestDetailQueryData = {
    detail: PullRequestDetail;
    lastLoadedAt: string;
};

export type PullRequestFilesQueryData = {
    items: Array<PullRequestFile>;
    lastLoadedAt: string;
};

export type FileDiffQueryData = {
    diff: FileDiff;
};

export type ReviewThreadsQueryData = {
    items: Array<ReviewThread>;
};

export type ConversationQueryData = {
    items: Array<PullRequestTimelineItem>;
};

export type PullRequestCommitsQueryData = {
    items: Array<PullRequestCommit>;
};

export type RelatedPullRequestsQueryData = {
    items: Array<PullRequestSummary>;
    headRefName: string | null;
    baseRefName: string | null;
};

export type RepositoryMetadataQueryData = {
    users: Array<RepositoryUser>;
    labels: Array<RepositoryLabel>;
};

export type RepoStackIndexQueryData = {
    pullRequests: Array<PullRequestSummary>;
    defaultBranch: string | null;
    lastLoadedAt: string | null;
};

export type PullRequestStackQueryData = {
    stack: ResolvedPullRequestStack;
};

export type InboxFetchResult = {
    data: InboxQueryData;
    successes: number;
    failure: SessionError | null;
};

export type InboxSectionFetchScope = ReadonlyArray<InboxSectionId> | undefined;
