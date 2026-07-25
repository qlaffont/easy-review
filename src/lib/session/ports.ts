import type { PullRequestSummary, Repository } from "#/lib/session/types.ts";

export type GithubViewer = {
    login: string;
    name: string | null;
    avatarUrl: string | null;
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
};

/** Browser persistence, narrowed to what the session needs so IndexedDB can replace it later. */
export type KeyValueStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
};
