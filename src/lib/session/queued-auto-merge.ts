import type { MergeMethod, PullRequestDetail } from "#/lib/session/types.ts";

/** A merge Easy Review will perform once the pull request meets GitHub’s merge requirements. */
export type QueuedAutoMerge = {
    repository: string;
    number: number;
    method: MergeMethod;
    deleteHeadBranch: boolean;
};

const MERGE_METHODS = new Set<MergeMethod>(["merge", "squash", "rebase"]);

export function queuedAutoMergeStorageKey(login: string): string {
    return `auto-merge:queue:${login}`;
}

export function queuedAutoMergeKey(repository: string, number: number): string {
    return `${repository}#${number}`;
}

export function parseQueuedAutoMerges(raw: string | null): Map<string, QueuedAutoMerge> {
    const queue = new Map<string, QueuedAutoMerge>();
    if (!raw) {
        return queue;
    }

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return queue;
        }

        for (const entry of parsed) {
            const item = asQueuedAutoMerge(entry);
            if (item) {
                queue.set(queuedAutoMergeKey(item.repository, item.number), item);
            }
        }
    } catch {
        return queue;
    }

    return queue;
}

export function serializeQueuedAutoMerges(queue: Map<string, QueuedAutoMerge>): string {
    return JSON.stringify([...queue.values()]);
}

/** Overlay in-app queue onto GitHub detail so the UI never depends on repo auto-merge settings. */
export function applyQueuedAutoMerge(
    detail: PullRequestDetail,
    queued: QueuedAutoMerge | undefined,
): PullRequestDetail {
    if (!queued) {
        return {
            ...detail,
            autoMergeEnabled: false,
            autoMergeMethod: null,
        };
    }

    return {
        ...detail,
        autoMergeEnabled: true,
        autoMergeMethod: queued.method,
    };
}

export function shouldUpdateBranchForAutoMerge(
    pullRequest: Pick<
        PullRequestDetail,
        "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "viewerCanUpdateBranch"
    >,
): boolean {
    if (pullRequest.state !== "open" || pullRequest.isDraft) {
        return false;
    }

    if (pullRequest.mergeable === "conflicting" || pullRequest.mergeStateStatus === "dirty") {
        return false;
    }

    return pullRequest.mergeStateStatus === "behind" && pullRequest.viewerCanUpdateBranch;
}

/**
 * True when Easy Review should actually merge. Unknown / blocked / behind stay queued
 * until GitHub reports a mergeable status. Behind pull requests are updated first when
 * {@link shouldUpdateBranchForAutoMerge} is true.
 */
export function isPullRequestReadyToAutoMerge(
    pullRequest: Pick<PullRequestDetail, "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "reviewDecision">,
): boolean {
    if (pullRequest.state !== "open" || pullRequest.isDraft) {
        return false;
    }

    if (pullRequest.mergeable === "conflicting" || pullRequest.mergeStateStatus === "dirty") {
        return false;
    }

    if (pullRequest.reviewDecision === "review-required" || pullRequest.reviewDecision === "changes-requested") {
        return false;
    }

    return pullRequest.mergeStateStatus === "clean" || pullRequest.mergeStateStatus === "has_hooks";
}

/** Toast copy after a bulk auto-merge: how many merged now vs still waiting. */
export function describeAutoMergeBatchResult(result: { queued: number; merged: ReadonlyArray<unknown> }): string {
    const mergedCount = result.merged.length;
    const remaining = Math.max(0, result.queued - mergedCount);

    if (mergedCount === 0 && remaining === 0) {
        return "No pull requests to auto-merge";
    }
    if (remaining === 0) {
        return mergedCount === 1 ? "Merged 1 pull request" : `Merged ${mergedCount} pull requests`;
    }
    if (mergedCount === 0) {
        return remaining === 1
            ? "1 pull request queued until it's ready"
            : `${remaining} pull requests queued until they're ready`;
    }
    return `Merged ${mergedCount} · ${remaining} queued until ready`;
}

function asQueuedAutoMerge(value: unknown): QueuedAutoMerge | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const record = value as Partial<QueuedAutoMerge>;
    if (typeof record.repository !== "string" || record.repository.length === 0) {
        return null;
    }
    if (typeof record.number !== "number" || !Number.isInteger(record.number) || record.number < 1) {
        return null;
    }
    if (typeof record.method !== "string" || !MERGE_METHODS.has(record.method)) {
        return null;
    }

    return {
        repository: record.repository,
        number: record.number,
        method: record.method,
        deleteHeadBranch: Boolean(record.deleteHeadBranch),
    };
}
