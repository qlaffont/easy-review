import { useEffect, useState } from "react";

export type InboxPreferences = {
    /** Desktop notifications when open inbox sections change while the tab is in the background. */
    backgroundNotifications: boolean;
    /** When true, inbox rows open Easy Review. When false, they open GitHub. */
    openInEasyReview: boolean;
};

const STORAGE_KEY = "easy-review:inbox-prefs:v1";

const DEFAULT_PREFERENCES: InboxPreferences = {
    backgroundNotifications: false,
    openInEasyReview: false,
};

function getBrowserLocalStorage(): Storage | null {
    if (typeof window === "undefined") {
        return null;
    }

    if (window.localStorage) {
        return window.localStorage;
    }

    const globalStorage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    return globalStorage ?? null;
}

function readPreferences(): InboxPreferences {
    const storage = getBrowserLocalStorage();
    if (!storage) {
        return DEFAULT_PREFERENCES;
    }

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) {
            return DEFAULT_PREFERENCES;
        }

        const parsed = JSON.parse(raw) as Partial<InboxPreferences>;
        return {
            backgroundNotifications: Boolean(parsed.backgroundNotifications),
            openInEasyReview: Boolean(parsed.openInEasyReview),
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

type PreferencesListener = (preferences: InboxPreferences) => void;

let cachedPreferences: InboxPreferences | null = null;
const preferencesListeners = new Set<PreferencesListener>();

function getPreferences(): InboxPreferences {
    if (cachedPreferences === null) {
        cachedPreferences = readPreferences();
    }
    return cachedPreferences;
}

function commitPreferences(next: InboxPreferences): void {
    cachedPreferences = next;
    const storage = getBrowserLocalStorage();
    if (!storage) {
        for (const listener of preferencesListeners) {
            listener(next);
        }
        return;
    }

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Private mode / quota — keep in-memory prefs.
    }
    for (const listener of preferencesListeners) {
        listener(next);
    }
}

export function useInboxPreferences() {
    const [preferences, setPreferencesState] = useState<InboxPreferences>(getPreferences);

    useEffect(() => {
        const next = readPreferences();
        cachedPreferences = next;
        setPreferencesState(next);

        const listener: PreferencesListener = (value) => setPreferencesState(value);
        preferencesListeners.add(listener);
        return () => {
            preferencesListeners.delete(listener);
        };
    }, []);

    function setPreferences(patch: Partial<InboxPreferences>) {
        commitPreferences({ ...getPreferences(), ...patch });
    }

    return [preferences, setPreferences] as const;
}

export function inboxPreferencesEnabled(): boolean {
    return getPreferences().backgroundNotifications;
}

export function inboxOpensInEasyReview(): boolean {
    return getPreferences().openInEasyReview;
}

/** Clears the in-memory prefs cache (tests). */
export function resetInboxPreferencesCache(): void {
    cachedPreferences = null;
}
