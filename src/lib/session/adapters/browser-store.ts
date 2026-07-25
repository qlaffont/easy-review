import type { KeyValueStore } from "#/lib/session/ports.ts";

/** Bumped whenever the persisted shape changes, so stale entries are simply never read. */
const NAMESPACE = "easy-review:v1";

function namespaced(key: string): string {
    return `${NAMESPACE}:${key}`;
}

/**
 * localStorage-backed persistence. Every call is wrapped because storage throws in private
 * browsing, when the quota is exceeded, or when the user disabled it entirely.
 */
export function createBrowserStore(storage: Storage | undefined = globalThis.localStorage): KeyValueStore {
    return {
        get(key) {
            try {
                return Promise.resolve(storage?.getItem(namespaced(key)) ?? null);
            } catch {
                return Promise.resolve(null);
            }
        },
        set(key, value) {
            try {
                storage?.setItem(namespaced(key), value);
            } catch {
                // Nothing we can do: the session keeps working in memory for this tab.
            }
            return Promise.resolve();
        },
        remove(key) {
            try {
                storage?.removeItem(namespaced(key));
            } catch {
                // Same as above.
            }
            return Promise.resolve();
        },
    };
}
