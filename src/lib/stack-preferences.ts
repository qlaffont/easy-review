import { useEffect, useState } from "react";

export type StackPreferences = {
    /** When false, no stack UI or repo index fetches run. */
    enabled: boolean;
    /** Hide closed pull requests in the PR stack panel. */
    hideClosed: boolean;
};

const STORAGE_KEY = "easy-review:stack-prefs:v1";

const DEFAULT_PREFERENCES: StackPreferences = {
    enabled: false,
    hideClosed: false,
};

function readPreferences(): StackPreferences {
    if (typeof window === "undefined") {
        return DEFAULT_PREFERENCES;
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return DEFAULT_PREFERENCES;
        }

        const parsed = JSON.parse(raw) as Partial<StackPreferences>;
        return {
            enabled: Boolean(parsed.enabled),
            hideClosed: Boolean(parsed.hideClosed),
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

type PreferencesListener = (preferences: StackPreferences) => void;

let cachedPreferences: StackPreferences | null = null;
const preferencesListeners = new Set<PreferencesListener>();

function getPreferences(): StackPreferences {
    if (cachedPreferences === null) {
        cachedPreferences = readPreferences();
    }
    return cachedPreferences;
}

function commitPreferences(next: StackPreferences): void {
    cachedPreferences = next;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Private mode / quota — keep in-memory prefs.
    }
    for (const listener of preferencesListeners) {
        listener(next);
    }
}

/** Shared across mounts so inbox rows and the PR stack panel stay in sync. */
export function useStackPreferences() {
    const [preferences, setPreferencesState] = useState<StackPreferences>(getPreferences);

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

    function setPreferences(patch: Partial<StackPreferences>) {
        commitPreferences({ ...getPreferences(), ...patch });
    }

    return [preferences, setPreferences] as const;
}

/** Sync read for session / non-React callers. */
export function getStackPreferences(): StackPreferences {
    return getPreferences();
}

export function replaceStackPreferences(preferences: StackPreferences): void {
    commitPreferences(preferences);
}

export function areStacksEnabled(): boolean {
    return getPreferences().enabled;
}
