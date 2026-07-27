import { useEffect, useState } from "react";

export type DiffLayout = "unified" | "split";

export type DiffPreferences = {
    layout: DiffLayout;
    hideWhitespace: boolean;
    compactLineHeight: boolean;
    minimizeComments: boolean;
    /** When false, the changed-files sidebar is hidden so the diff can use full width. */
    showFileList: boolean;
    /** Expand only the Files changed panel to the full viewport width. */
    fullWidth: boolean;
};

const STORAGE_KEY = "easy-review:diff-prefs:v1";

const DEFAULT_PREFERENCES: DiffPreferences = {
    layout: "split",
    hideWhitespace: false,
    compactLineHeight: false,
    minimizeComments: false,
    showFileList: true,
    fullWidth: false,
};

function readPreferences(): DiffPreferences {
    if (typeof window === "undefined") {
        return DEFAULT_PREFERENCES;
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return DEFAULT_PREFERENCES;
        }

        const parsed = JSON.parse(raw) as Partial<DiffPreferences>;
        return {
            layout: parsed.layout === "split" ? "split" : "unified",
            hideWhitespace: Boolean(parsed.hideWhitespace),
            compactLineHeight: Boolean(parsed.compactLineHeight),
            minimizeComments: Boolean(parsed.minimizeComments),
            showFileList: parsed.showFileList !== false,
            fullWidth: Boolean(parsed.fullWidth),
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

type PreferencesListener = (preferences: DiffPreferences) => void;

let cachedPreferences: DiffPreferences | null = null;
const preferencesListeners = new Set<PreferencesListener>();

function getPreferences(): DiffPreferences {
    if (cachedPreferences === null) {
        cachedPreferences = readPreferences();
    }
    return cachedPreferences;
}

function commitPreferences(next: DiffPreferences): void {
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

/** Shared across mounts so page layout and the Files changed toolbar stay in sync. */
export function useDiffPreferences() {
    const [preferences, setPreferencesState] = useState<DiffPreferences>(getPreferences);

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

    function setPreferences(patch: Partial<DiffPreferences>) {
        commitPreferences({ ...getPreferences(), ...patch });
    }

    return [preferences, setPreferences] as const;
}

export function viewedFilesStorageKey(repository: string, number: number, headSha: string): string {
    return `easy-review:viewed:v1:${repository}#${number}:${headSha || "unknown"}`;
}

export function readViewedPaths(repository: string, number: number, headSha: string): Set<string> {
    if (typeof window === "undefined") {
        return new Set();
    }

    try {
        const raw = window.localStorage.getItem(viewedFilesStorageKey(repository, number, headSha));
        if (!raw) {
            return new Set();
        }

        const parsed = JSON.parse(raw) as unknown;
        return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
        return new Set();
    }
}

export function writeViewedPaths(repository: string, number: number, headSha: string, paths: Set<string>): void {
    try {
        window.localStorage.setItem(viewedFilesStorageKey(repository, number, headSha), JSON.stringify([...paths]));
    } catch {
        // ignore
    }
}
