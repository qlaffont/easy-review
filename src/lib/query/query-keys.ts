/** Reserved section-id slot for shared section searches: never a real section id. */
export const INBOX_POOL_SEGMENT = "__pool__";

/** Hierarchical query keys — every server fetch goes through here. */
export const queryKeys = {
    auth: {
        viewer: ["auth", "viewer"] as const,
    },
    repos: {
        list: (login: string) => ["repos", "list", login] as const,
    },
    inbox: {
        /** Merged aggregate written by section fetches — not fetched directly. */
        sections: (login: string) => ["inbox", "sections", login] as const,
        section: (login: string, sectionId: string) => ["inbox", "section", login, sectionId] as const,
        /**
         * Shared search behind several sections (see `sectionPoolSearchQuery`). Nested under the
         * section prefix so every section invalidation also marks it stale; never observed, never persisted.
         */
        pools: (login: string) => ["inbox", "section", login, INBOX_POOL_SEGMENT] as const,
        pool: (login: string, repositories: string, query: string) =>
            ["inbox", "section", login, INBOX_POOL_SEGMENT, repositories, query] as const,
    },
    pullRequest: {
        detail: (key: string) => ["pullRequest", key, "detail"] as const,
        files: (key: string) => ["pullRequest", key, "files"] as const,
        diff: (key: string, path: string) => ["pullRequest", key, "diff", path] as const,
        threads: (key: string) => ["pullRequest", key, "threads"] as const,
        conversation: (key: string) => ["pullRequest", key, "conversation"] as const,
        commits: (key: string) => ["pullRequest", key, "commits"] as const,
        related: (key: string) => ["pullRequest", key, "related"] as const,
        /** Open pull requests whose head branch is this one's base (stack suggestion). */
        stackBelow: (key: string, baseRefName: string) => ["pullRequest", key, "stackBelow", baseRefName] as const,
    },
    repository: {
        metadata: (repository: string) => ["repository", repository, "metadata"] as const,
    },
} as const;

export type InboxSectionQueryKey = ReturnType<typeof queryKeys.inbox.sections>;
