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
    },
    pullRequest: {
        detail: (key: string) => ["pullRequest", key, "detail"] as const,
        files: (key: string) => ["pullRequest", key, "files"] as const,
        diff: (key: string, path: string) => ["pullRequest", key, "diff", path] as const,
        threads: (key: string) => ["pullRequest", key, "threads"] as const,
        conversation: (key: string) => ["pullRequest", key, "conversation"] as const,
        commits: (key: string) => ["pullRequest", key, "commits"] as const,
        related: (key: string) => ["pullRequest", key, "related"] as const,
        stack: (key: string) => ["pullRequest", key, "stack"] as const,
    },
    repository: {
        metadata: (repository: string) => ["repository", repository, "metadata"] as const,
        stackIndex: (repository: string) => ["repository", repository, "stackIndex"] as const,
    },
} as const;

export type InboxSectionQueryKey = ReturnType<typeof queryKeys.inbox.sections>;
