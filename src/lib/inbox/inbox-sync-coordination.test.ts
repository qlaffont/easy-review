import { describe, expect, it } from "vitest";

import { claimInboxSyncLeadership, isNewerInboxLoad } from "#/lib/inbox/inbox-sync-coordination.ts";

/** Web Locks in miniature: one holder per name, waiters served in request order, aborts dequeue. */
function createFakeLocks() {
    type Waiter = { callback: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
    const queue: Array<Waiter> = [];
    let held = false;

    function grantNext(): void {
        if (held) {
            return;
        }
        const next = queue.shift();
        if (!next) {
            return;
        }
        held = true;
        void next.callback().then(() => {
            held = false;
            next.resolve();
            grantNext();
        });
    }

    return {
        request(_name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) {
            return new Promise<void>((resolve, reject) => {
                const waiter = { callback, resolve, reject };
                options.signal.addEventListener("abort", () => {
                    const index = queue.indexOf(waiter);
                    if (index >= 0) {
                        queue.splice(index, 1);
                        reject(new DOMException("Aborted", "AbortError"));
                    }
                });
                queue.push(waiter);
                grantNext();
            });
        },
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Inbox sync leadership", () => {
    it("lets exactly one tab lead, and hands over when it closes", async () => {
        const locks = createFakeLocks();
        const first = claimInboxSyncLeadership(locks);
        const second = claimInboxSyncLeadership(locks);
        await settle();

        expect([first.isLeader(), second.isLeader()]).toEqual([true, false]);

        first.close();
        await settle();

        expect([first.isLeader(), second.isLeader()]).toEqual([false, true]);
        second.close();
    });

    it("passes the lead to a background tab when the leader is looked at", async () => {
        const locks = createFakeLocks();
        const looked = claimInboxSyncLeadership(locks);
        const background = claimInboxSyncLeadership(locks);
        await settle();

        looked.yieldLeadership();
        await settle();

        expect([looked.isLeader(), background.isLeader()]).toEqual([false, true]);
        looked.close();
        background.close();
    });

    it("keeps the lead when it is the only tab", async () => {
        const locks = createFakeLocks();
        const only = claimInboxSyncLeadership(locks);
        await settle();

        only.yieldLeadership();
        await settle();

        expect(only.isLeader()).toBe(true);
        only.close();
    });

    it("leads in every tab where Web Locks are missing", () => {
        expect(claimInboxSyncLeadership(null).isLeader()).toBe(true);
    });
});

describe("isNewerInboxLoad", () => {
    it("only adopts data loaded after what the tab already has", () => {
        expect(isNewerInboxLoad("2026-11-13T10:00:00.000Z", null)).toBe(true);
        expect(isNewerInboxLoad("2026-11-13T10:00:00.000Z", "2026-11-13T09:00:00.000Z")).toBe(true);
        expect(isNewerInboxLoad("2026-11-13T09:00:00.000Z", "2026-11-13T10:00:00.000Z")).toBe(false);
        expect(isNewerInboxLoad(null, null)).toBe(false);
    });
});
