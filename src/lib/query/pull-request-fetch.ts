import type {
    ConversationQueryData,
    FileDiffQueryData,
    PullRequestCommitsQueryData,
    PullRequestDetailQueryData,
    PullRequestFilesQueryData,
    RelatedPullRequestsQueryData,
    RepositoryMetadataQueryData,
    ReviewThreadsQueryData,
} from "#/lib/query/types.ts";
import type { EasyReviewSession } from "#/lib/session/session.ts";

import { getInboxQueryData } from "#/lib/query/inbox.ts";
import { toSessionError } from "#/lib/session/errors.ts";
import { selectRelatedPullRequests } from "#/lib/session/related-pull-requests.ts";
import { pullRequestKey } from "#/lib/session/session.ts";

export async function fetchPullRequestDetail(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<PullRequestDetailQueryData> {
    void signal;
    const detail = await session.github.getPullRequest(session.requireToken(), repository, number);
    return { detail, lastLoadedAt: new Date().toISOString() };
}

export async function fetchPullRequestFiles(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<PullRequestFilesQueryData> {
    void signal;
    const items = await session.github.listPullRequestFiles(session.requireToken(), repository, number);
    return { items, lastLoadedAt: new Date().toISOString() };
}

export async function fetchFileDiff(
    session: EasyReviewSession,
    repository: string,
    number: number,
    path: string,
    options: { force?: boolean; previousPath?: string | null } = {},
    signal?: AbortSignal,
): Promise<FileDiffQueryData> {
    void signal;
    const diff = await session.github.getPullRequestFileDiff(session.requireToken(), repository, number, path, {
        force: options.force,
        previousPath: options.previousPath,
    });
    return { diff };
}

export async function fetchReviewThreads(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<ReviewThreadsQueryData> {
    void signal;
    const items = await session.github.listReviewThreads(session.requireToken(), repository, number);
    return { items };
}

export async function fetchConversation(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<ConversationQueryData> {
    void signal;
    const items = await session.github.listPullRequestTimeline(session.requireToken(), repository, number);
    return { items };
}

export async function fetchPullRequestCommits(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<PullRequestCommitsQueryData> {
    void signal;
    const items = await session.github.listPullRequestCommits(session.requireToken(), repository, number);
    return { items };
}

function relatedContextFromSession(
    session: EasyReviewSession,
    repository: string,
    number: number,
): { headRefName: string; baseRefName: string; createdAt: string } | null {
    const key = pullRequestKey(repository, number);
    const login = session.state.state.auth.viewer?.login ?? "";
    const inboxSummary = getInboxQueryData(session.queryClient, login)?.pullRequests.find(
        (pullRequest) => pullRequest.key === key,
    );
    const detail = session.queryClient.getQueryData<PullRequestDetailQueryData>(["pullRequest", key, "detail"])?.detail;
    const source = detail ?? inboxSummary;
    if (!source) {
        return null;
    }
    return {
        headRefName: source.headRefName,
        baseRefName: source.baseRefName,
        createdAt: source.createdAt,
    };
}

async function repositoriesForRelatedSearch(session: EasyReviewSession): Promise<Array<string>> {
    const repos = session.state.state.repos;
    if (repos.status !== "ready" && repos.available.length === 0) {
        await session.refreshRepositories();
    }
    return repos.available.map((entry) => entry.nameWithOwner);
}

export async function fetchRelatedPullRequests(
    session: EasyReviewSession,
    repository: string,
    number: number,
    signal?: AbortSignal,
): Promise<RelatedPullRequestsQueryData> {
    void signal;
    const context = relatedContextFromSession(session, repository, number);
    if (!context) {
        return { items: [], headRefName: null, baseRefName: null };
    }

    const repositories = (await repositoriesForRelatedSearch(session)).filter(
        (nameWithOwner) => nameWithOwner !== repository,
    );

    const fetched =
        repositories.length === 0
            ? []
            : await session.github.listRelatedPullRequests(session.requireToken(), {
                  repositories,
                  headRefName: context.headRefName,
                  baseRefName: context.baseRefName,
              });

    const items = selectRelatedPullRequests({
        pullRequests: fetched,
        headRefName: context.headRefName,
        baseRefName: context.baseRefName,
        excludeRepository: repository,
        focalCreatedAt: context.createdAt,
    });

    return {
        items,
        headRefName: context.headRefName,
        baseRefName: context.baseRefName,
    };
}

export async function fetchRepositoryMetadata(
    session: EasyReviewSession,
    repository: string,
    signal?: AbortSignal,
): Promise<RepositoryMetadataQueryData> {
    void signal;
    const [users, labels] = await Promise.all([
        session.github.listRepositoryAssignees(session.requireToken(), repository),
        session.github.listRepositoryLabels(session.requireToken(), repository),
    ]);
    return { users, labels };
}

export function sessionErrorFromUnknown(error: unknown) {
    return toSessionError(error);
}
