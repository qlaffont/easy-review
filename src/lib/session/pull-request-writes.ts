/** What to re-read from GitHub once a pull request has no write left in flight. */
export type PullRequestRefreshOptions = {
    /** Reload conversation/threads when those surfaces were already fetched. */
    reloadSecondary?: boolean;
    /** Always reload review threads and conversation (after submitting review comments). */
    reloadReviewSurfaces?: boolean;
    /** Refresh other GitHub stack layers after merge / close. */
    reloadStack?: boolean;
};

type PullRequestRef = { repository: string; number: number };

type WriteQueue = {
    /** Settles when every write enqueued so far has settled. Never rejects. */
    tail: Promise<unknown>;
    pending: number;
    /** Bumped by each enqueue, so a read can tell whether a write started while it ran. */
    stamp: number;
    refresh: PullRequestRefreshOptions | null;
};

/**
 * Lets the UI apply an action at once and tell GitHub afterwards. Writes to one pull request run
 * one at a time in click order, because later ones depend on earlier ones: a review must include
 * the comment staged just before it, and two staged comments must not each open a pending review.
 *
 * One refetch reconciles a whole burst of writes, once the last has settled. The last write's
 * promise waits for that refetch unless it asks not to.
 */
export function createPullRequestWriteQueues(
    runRefresh: (pullRequest: PullRequestRef, options: PullRequestRefreshOptions) => Promise<void>,
) {
    const queues = new Map<string, WriteQueue>();

    function queueFor({ repository, number }: PullRequestRef): WriteQueue {
        const key = `${repository}#${number}`;
        const existing = queues.get(key);
        if (existing) {
            return existing;
        }
        const queue: WriteQueue = { tail: Promise.resolve(), pending: 0, stamp: 0, refresh: null };
        queues.set(key, queue);
        return queue;
    }

    async function refreshIfIdle(pullRequest: PullRequestRef, queue: WriteQueue): Promise<void> {
        if (queue.pending > 0 || !queue.refresh) {
            return;
        }
        const options = queue.refresh;
        queue.refresh = null;
        await runRefresh(pullRequest, options);
    }

    function requestRefresh(pullRequest: PullRequestRef, options: PullRequestRefreshOptions): Promise<void> {
        const queue = queueFor(pullRequest);
        queue.refresh = { ...queue.refresh, ...options };
        return refreshIfIdle(pullRequest, queue);
    }

    function enqueue<TResult>(
        pullRequest: PullRequestRef,
        write: () => Promise<TResult>,
        options: {
            refresh?: PullRequestRefreshOptions;
            /** Settle as soon as GitHub accepts the write, for callers that act on it right away. */
            settleBeforeRefresh?: boolean;
            /** Undo what the UI already shows. Runs before the write's promise rejects. */
            onFailure?: () => void | Promise<void>;
        } = {},
    ): Promise<TResult> {
        const queue = queueFor(pullRequest);
        queue.pending += 1;
        queue.stamp += 1;

        const settled = queue.tail.then(write).then(
            (value) => {
                queue.refresh = options.refresh ? { ...queue.refresh, ...options.refresh } : queue.refresh;
                return value;
            },
            async (error: unknown) => {
                await options.onFailure?.();
                // A rejected write can still have reached GitHub, so re-read instead of trusting the undo.
                queue.refresh = { ...queue.refresh, reloadReviewSurfaces: true };
                throw error;
            },
        );
        queue.tail = settled.catch(() => undefined);

        return settled.finally(async () => {
            queue.pending -= 1;
            const refreshing = refreshIfIdle(pullRequest, queue);
            if (!options.settleBeforeRefresh) {
                await refreshing;
            }
        });
    }

    /**
     * Read from GitHub without undoing what the UI already shows: a response that overlapped a
     * write may not include it, so keep the painted data and re-read once the writes are done.
     */
    async function readAround<TData>(
        pullRequest: PullRequestRef,
        read: () => Promise<TData>,
        painted: () => TData | undefined,
    ): Promise<TData> {
        const queue = queueFor(pullRequest);
        const { stamp, pending } = queue;
        const fresh = await read();
        if (pending === 0 && queue.stamp === stamp) {
            return fresh;
        }
        void requestRefresh(pullRequest, { reloadReviewSurfaces: true });
        return painted() ?? fresh;
    }

    return {
        enqueue,
        readAround,
        requestRefresh,
        hasPending: (pullRequest: PullRequestRef) => queueFor(pullRequest).pending > 0,
        stamp: (pullRequest: PullRequestRef) => queueFor(pullRequest).stamp,
        /** Settles when every write enqueued so far has settled. Never rejects. */
        settled: (pullRequest: PullRequestRef) => queueFor(pullRequest).tail,
    };
}
