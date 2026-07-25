import type { KeyValueStore } from "#/lib/session/ports.ts";

export type MemoryStore = KeyValueStore & {
    entries(): Record<string, string>;
};

/**
 * Stand-in for browser persistence. Reusing the same instance across two sessions simulates a
 * page reload.
 */
export function createMemoryStore(initial: Record<string, string> = {}): MemoryStore {
    const data = new Map<string, string>(Object.entries(initial));

    return {
        get(key) {
            return Promise.resolve(data.get(key) ?? null);
        },
        set(key, value) {
            data.set(key, value);
            return Promise.resolve();
        },
        remove(key) {
            data.delete(key);
            return Promise.resolve();
        },
        entries() {
            return Object.fromEntries(data);
        },
    };
}
