import type { QueryClient } from "@tanstack/react-query";

import { CACHE_POLICY } from "#/lib/query/cache-policy.ts";
import { inboxQueryKey } from "#/lib/query/inbox.ts";
import { queryKeys } from "#/lib/query/query-keys.ts";
import { pullRequestKey } from "#/lib/session/session.ts";

export type CacheInvalidationReason =
    | "page-reload"
    | "manual-refresh"
    | "mutation"
    | "visibility"
    | "navigation"
    | "check-poll"
    | "repo-selection";

/** After F5 — mark everything stale; active queries refetch with placeholderData. */
export function invalidateAllQueriesOnPageReload(queryClient: QueryClient): void {
    void queryClient.invalidateQueries({ refetchType: "active" });
}

/** User clicked Refresh or catalog action — force refetch visible data. */
export async function invalidateInboxForRefresh(queryClient: QueryClient, login: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: inboxQueryKey(login), refetchType: "active" });
}

/** Repo allowlist changed — inbox classification may shift. */
export function invalidateInboxAfterRepoSelection(queryClient: QueryClient, login: string): void {
    void queryClient.invalidateQueries({ queryKey: inboxQueryKey(login), refetchType: "active" });
}

/** Tab focus / quiet interval — refetch only when outside the background window. */
export function revalidateInboxInBackground(
    queryClient: QueryClient,
    login: string,
    lastLoadedAt: string | null | undefined,
): void {
    const { backgroundRevalidateMinMs } = CACHE_POLICY.inbox;
    if (lastLoadedAt && Date.now() - Date.parse(lastLoadedAt) < backgroundRevalidateMinMs) {
        return;
    }
    void queryClient.invalidateQueries({ queryKey: inboxQueryKey(login), refetchType: "active" });
}

/** Manual PR refresh — detail + files (+ drop cached diffs). Awaits network completion. */
export async function invalidatePullRequestForManualRefresh(
    queryClient: QueryClient,
    repository: string,
    number: number,
): Promise<void> {
    const key = pullRequestKey(repository, number);
    queryClient.removeQueries({ queryKey: ["pullRequest", key, "diff"] });
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.detail(key), refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.files(key), refetchType: "active" }),
    ]);
}

/** CI check poll — detail only (cheap vs files/threads/conversation). */
export function invalidatePullRequestDetailForCheckPoll(
    queryClient: QueryClient,
    repository: string,
    number: number,
): void {
    const key = pullRequestKey(repository, number);
    void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.detail(key), refetchType: "active" });
}

/** Tab focus on PR page — detail only, throttled. */
export function revalidatePullRequestDetailInBackground(
    queryClient: QueryClient,
    repository: string,
    number: number,
    lastLoadedAt: string | null | undefined,
): void {
    const { focusRevalidateMinMs } = CACHE_POLICY.pullRequest.detail;
    if (!shouldSkipDetailRevalidate(lastLoadedAt, focusRevalidateMinMs)) {
        invalidatePullRequestDetailForCheckPoll(queryClient, repository, number);
    }
}

/** CI check poll — detail only, throttled to the poll interval (avoids double-fetch after manual refresh). */
export function revalidatePullRequestDetailForCheckPoll(
    queryClient: QueryClient,
    repository: string,
    number: number,
    lastLoadedAt: string | null | undefined,
): void {
    const { checkPollIntervalMs } = CACHE_POLICY.pullRequest.detail;
    if (!shouldSkipDetailRevalidate(lastLoadedAt, checkPollIntervalMs)) {
        invalidatePullRequestDetailForCheckPoll(queryClient, repository, number);
    }
}

function shouldSkipDetailRevalidate(lastLoadedAt: string | null | undefined, minIntervalMs: number): boolean {
    if (!lastLoadedAt) {
        return false;
    }
    return Date.now() - Date.parse(lastLoadedAt) < minIntervalMs;
}

/** After merge / label / review / close — refresh timeline surfaces (detail often patched inline). */
export function invalidatePullRequestSecondaryAfterMutation(
    queryClient: QueryClient,
    login: string,
    repository: string,
    number: number,
    options?: { includeDetail?: boolean },
): void {
    const key = pullRequestKey(repository, number);
    if (options?.includeDetail) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.detail(key), refetchType: "active" });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.conversation(key), refetchType: "active" });
    if (queryClient.getQueryData(queryKeys.pullRequest.threads(key))) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.threads(key), refetchType: "active" });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest.related(key), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: inboxQueryKey(login), refetchType: "active" });
}

/** After merge / label / review / close — refresh overview + timeline surfaces. */
export function invalidatePullRequestAfterMutation(
    queryClient: QueryClient,
    login: string,
    repository: string,
    number: number,
): void {
    invalidatePullRequestSecondaryAfterMutation(queryClient, login, repository, number, { includeDetail: true });
}

/** @deprecated Use invalidatePullRequestAfterMutation */
export function invalidatePullRequestQueries(
    queryClient: QueryClient,
    login: string,
    repository: string,
    number: number,
): void {
    invalidatePullRequestAfterMutation(queryClient, login, repository, number);
}

export function invalidateInboxQuery(queryClient: QueryClient, login: string): void {
    void invalidateInboxForRefresh(queryClient, login);
}
