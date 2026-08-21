/** Shared stale / gc windows — tune here to balance freshness vs GitHub rate limits. */
export const CACHE_POLICY = {
    /** Default for queries without an explicit policy. */
    default: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
    },
    inbox: {
        staleTime: 2 * 60_000,
        gcTime: 30 * 60_000,
        /** Background focus / interval revalidates skip below this. */
        backgroundRevalidateMinMs: 90_000,
    },
    repos: {
        staleTime: 30 * 60_000,
        gcTime: 24 * 60 * 60_000,
    },
    pullRequest: {
        /** CI / mergeability rollup while a PR tab is open. */
        detail: {
            staleTime: 5_000,
            gcTime: 30 * 60_000,
            checkPollIntervalMs: 5_000,
            /** Tab focus revalidate — detail only, not files/threads. */
            focusRevalidateMinMs: 30_000,
        },
        files: {
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
        },
        diff: {
            staleTime: 10 * 60_000,
            gcTime: 60 * 60_000,
        },
        threads: {
            staleTime: 2 * 60_000,
            gcTime: 30 * 60_000,
        },
        conversation: {
            staleTime: 2 * 60_000,
            gcTime: 30 * 60_000,
        },
        commits: {
            staleTime: 10 * 60_000,
            gcTime: 30 * 60_000,
        },
        related: {
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
        },
    },
    repository: {
        metadata: {
            staleTime: 15 * 60_000,
            gcTime: 60 * 60_000,
        },
    },
} as const;

export function isQueryFresh(lastLoadedAt: string | null | undefined, staleTimeMs: number): boolean {
    if (!lastLoadedAt) {
        return false;
    }
    return Date.now() - Date.parse(lastLoadedAt) < staleTimeMs;
}

/** True when a background revalidate is worth a network round-trip. */
export function shouldBackgroundRevalidate(lastLoadedAt: string | null | undefined, minIntervalMs: number): boolean {
    if (!lastLoadedAt) {
        return true;
    }
    return Date.now() - Date.parse(lastLoadedAt) >= minIntervalMs;
}

/** Detect a full browser reload (F5 / Cmd+R), not in-app navigation. */
export function isHardPageReload(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === "reload";
}
