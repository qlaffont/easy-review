import { useEffect, useState, useSyncExternalStore } from "react";

/** GitHub's budget for one API resource, as its `x-ratelimit-*` headers last reported it. */
export type GithubRateLimit = {
    /** `graphql`, `core`, `search`… The Inbox spends `graphql`. */
    resource: string;
    limit: number;
    remaining: number;
    resetAt: string;
};

/** Below this share of the hourly budget, automatic refreshes stop until the window resets. */
export const RATE_LIMIT_LOW_RATIO = 0.1;

const STORAGE_KEY = "easy-review:github-rate-limit:v1";

let memory: Record<string, GithubRateLimit> = {};
const listeners = new Set<() => void>();

export function rateLimitFromHeaders(headers: Headers): GithubRateLimit | null {
    const limit = Number(headers.get("x-ratelimit-limit"));
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));

    if (
        !headers.has("x-ratelimit-limit") ||
        !headers.has("x-ratelimit-remaining") ||
        !headers.has("x-ratelimit-reset") ||
        !Number.isFinite(limit) ||
        !Number.isFinite(remaining) ||
        !Number.isFinite(reset) ||
        limit <= 0
    ) {
        return null;
    }

    return {
        resource: headers.get("x-ratelimit-resource") ?? "core",
        limit,
        remaining,
        resetAt: new Date(reset * 1000).toISOString(),
    };
}

function readAll(): Record<string, GithubRateLimit> {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as Record<string, GithubRateLimit>;
        }
    } catch {
        // Blocked storage: this tab's own observations still count.
    }
    return memory;
}

/** Remember the latest budget. Shared with other tabs: they spend the same token. */
export function recordGithubRateLimit(snapshot: GithubRateLimit): void {
    const all = { ...readAll(), [snapshot.resource]: snapshot };
    memory = all;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Kept in memory for this tab.
    }
    for (const listener of listeners) {
        listener();
    }
}

/** Latest budget for a resource, or null when unknown or its window already reset. */
export function githubRateLimit(resource = "graphql", now = Date.now()): GithubRateLimit | null {
    const snapshot = readAll()[resource];
    if (!snapshot || Date.parse(snapshot.resetAt) <= now) {
        return null;
    }
    return snapshot;
}

/** True while the budget is under {@link RATE_LIMIT_LOW_RATIO} and its window has not reset. */
export function isGithubRateLimitLow(resource = "graphql", now = Date.now()): boolean {
    const snapshot = githubRateLimit(resource, now);
    return snapshot !== null && snapshot.remaining < snapshot.limit * RATE_LIMIT_LOW_RATIO;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            listener();
        }
    };
    globalThis.addEventListener?.("storage", onStorage);
    return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.("storage", onStorage);
    };
}

function pausedUntil(): string | null {
    return isGithubRateLimitLow() ? (githubRateLimit()?.resetAt ?? null) : null;
}

/** When automatic Inbox refreshes are paused for the GitHub budget, the time they resume. */
export function useRateLimitPausedUntil(): string | null {
    const [, setTick] = useState(0);
    const resumeAt = useSyncExternalStore(subscribe, pausedUntil, () => null);

    useEffect(() => {
        if (!resumeAt) {
            return;
        }
        const timer = setTimeout(() => setTick((tick) => tick + 1), Math.max(0, Date.parse(resumeAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [resumeAt]);

    return resumeAt;
}

/** Test hook: forget every recorded budget. */
export function resetGithubRateLimit(): void {
    memory = {};
    try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
        // Nothing stored.
    }
}
