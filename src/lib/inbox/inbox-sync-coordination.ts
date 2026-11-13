import type { InboxQueryData } from "#/lib/query/types.ts";

const LEADER_LOCK = "easy-review:inbox-sync";
const CHANNEL = "easy-review:inbox";

/**
 * Which open tab runs the background Inbox sync. One tab at a time holds a Web Lock; the others
 * queue behind it and take over when it closes. Without Web Locks every tab leads, as before.
 */
export type InboxSyncLeadership = {
    isLeader(): boolean;
    /**
     * Step back so a tab the user is not looking at can sync instead. The lock goes to the next
     * tab in line, and this tab queues again: alone, it gets the lock straight back.
     */
    yieldLeadership(): void;
    close(): void;
};

type LockManagerLike = {
    request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
};

function lockManager(): LockManagerLike | null {
    const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
    return locks && typeof locks.request === "function" ? locks : null;
}

export function claimInboxSyncLeadership(locks: LockManagerLike | null = lockManager()): InboxSyncLeadership {
    if (!locks) {
        return { isLeader: () => true, yieldLeadership: () => {}, close: () => {} };
    }

    let leader = false;
    let closed = false;
    let release: (() => void) | null = null;
    let pending: AbortController | null = null;

    function request(): void {
        if (closed || pending || leader) {
            return;
        }
        const abort = new AbortController();
        pending = abort;
        locks!
            .request(LEADER_LOCK, { signal: abort.signal }, () => {
                pending = null;
                if (closed) {
                    return Promise.resolve();
                }
                leader = true;
                return new Promise<void>((resolve) => {
                    release = resolve;
                });
            })
            .catch(() => {
                // Aborted while queued (closed or yielded): nothing held.
                if (pending === abort) {
                    pending = null;
                }
            });
    }

    function letGo(): void {
        leader = false;
        release?.();
        release = null;
    }

    request();

    return {
        isLeader: () => leader,
        yieldLeadership() {
            if (!leader) {
                return;
            }
            letGo();
            request();
        },
        close() {
            closed = true;
            pending?.abort();
            pending = null;
            letGo();
        },
    };
}

export type InboxBroadcastMessage = {
    login: string;
    data: InboxQueryData;
};

export type InboxBroadcast = {
    post(message: InboxBroadcastMessage): void;
    close(): void;
};

/** Share freshly loaded Inbox data with the other open tabs. No-op where BroadcastChannel is missing. */
export function openInboxBroadcast(onMessage: (message: InboxBroadcastMessage) => void): InboxBroadcast {
    if (typeof BroadcastChannel === "undefined") {
        return { post: () => {}, close: () => {} };
    }

    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<InboxBroadcastMessage>) => {
        const message = event.data;
        if (message && typeof message.login === "string" && message.data) {
            onMessage(message);
        }
    };

    return {
        post(message) {
            try {
                channel.postMessage(message);
            } catch {
                // A closed channel or uncloneable payload only costs the other tabs a fetch.
            }
        },
        close() {
            channel.close();
        },
    };
}

/** Whether `incoming` was loaded after `current` (both `lastLoadedAt` ISO strings). */
export function isNewerInboxLoad(incoming: string | null, current: string | null): boolean {
    if (!incoming) {
        return false;
    }
    if (!current) {
        return true;
    }
    return Date.parse(incoming) > Date.parse(current);
}
