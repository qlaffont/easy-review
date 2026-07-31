import { useEffect, useState } from "react";

import type { GithubFileViewedState } from "#/lib/session/types.ts";

export type DiffLayout = "unified" | "split";

export type FileListLayout = "flat" | "tree";

export type DiffPreferences = {
    layout: DiffLayout;
    hideWhitespace: boolean;
    compactLineHeight: boolean;
    /** Soft-wrap long lines instead of horizontal scrolling. */
    wrapLines: boolean;
    minimizeComments: boolean;
    /** When false, the changed-files sidebar is hidden so the diff can use full width. */
    showFileList: boolean;
    /** Expand only the Files changed panel to the full viewport width. */
    fullWidth: boolean;
    /** Flat list of paths, or a compactable directory tree. */
    fileListLayout: FileListLayout;
    /** Desktop width of the changed-files sidebar in pixels. */
    fileListWidth: number;
    /** After submitting a review or merging, navigate back to the Inbox. */
    returnToInboxAfterReviewOrMerge: boolean;
};

export const FILE_LIST_WIDTH_DEFAULT = 256;
export const FILE_LIST_WIDTH_MIN = 180;
export const FILE_LIST_WIDTH_MAX = 520;

export function clampFileListWidth(width: number): number {
    if (!Number.isFinite(width)) {
        return FILE_LIST_WIDTH_DEFAULT;
    }
    return Math.min(FILE_LIST_WIDTH_MAX, Math.max(FILE_LIST_WIDTH_MIN, Math.round(width)));
}

const STORAGE_KEY = "easy-review:diff-prefs:v1";

const DEFAULT_PREFERENCES: DiffPreferences = {
    layout: "split",
    hideWhitespace: false,
    compactLineHeight: false,
    wrapLines: false,
    minimizeComments: false,
    showFileList: true,
    fullWidth: false,
    fileListLayout: "flat",
    fileListWidth: FILE_LIST_WIDTH_DEFAULT,
    returnToInboxAfterReviewOrMerge: false,
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
            wrapLines: Boolean(parsed.wrapLines),
            minimizeComments: Boolean(parsed.minimizeComments),
            showFileList: parsed.showFileList !== false,
            fullWidth: Boolean(parsed.fullWidth),
            fileListLayout: parsed.fileListLayout === "tree" ? "tree" : "flat",
            fileListWidth: clampFileListWidth(
                typeof parsed.fileListWidth === "number" ? parsed.fileListWidth : FILE_LIST_WIDTH_DEFAULT,
            ),
            returnToInboxAfterReviewOrMerge: Boolean(parsed.returnToInboxAfterReviewOrMerge),
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

/** Sync read for command-palette / non-React callers. */
export function shouldReturnToInboxAfterReviewOrMerge(): boolean {
    return getPreferences().returnToInboxAfterReviewOrMerge;
}

export function viewedFilesStorageKey(repository: string, number: number, headSha: string): string {
    return `easy-review:viewed:v1:${repository}#${number}:${headSha || "unknown"}`;
}

/** Path → head SHA at the moment the file was marked viewed. */
export type ViewedFileMarks = Record<string, string>;

export function viewedFileMarksStorageKey(repository: string, number: number): string {
    return `easy-review:viewed:v2:${repository}#${number}`;
}

export function readViewedFileMarks(repository: string, number: number, headSha: string): ViewedFileMarks {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(viewedFileMarksStorageKey(repository, number));
        if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const marks: ViewedFileMarks = {};
                for (const [path, sha] of Object.entries(parsed as Record<string, unknown>)) {
                    if (typeof sha === "string" && sha.length > 0) {
                        marks[path] = sha;
                    }
                }
                return marks;
            }
        }
    } catch {
        // fall through to v1 migration
    }

    // Migrate legacy per-head path lists into path→sha marks for the current head.
    try {
        const legacy = window.localStorage.getItem(viewedFilesStorageKey(repository, number, headSha));
        if (!legacy || !headSha) {
            return {};
        }
        const parsed = JSON.parse(legacy) as unknown;
        const paths = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        const marks: ViewedFileMarks = Object.fromEntries(paths.map((path) => [path, headSha]));
        writeViewedFileMarks(repository, number, marks);
        return marks;
    } catch {
        return {};
    }
}

export function writeViewedFileMarks(repository: string, number: number, marks: ViewedFileMarks): void {
    try {
        window.localStorage.setItem(viewedFileMarksStorageKey(repository, number), JSON.stringify(marks));
    } catch {
        // ignore
    }
}

export type FileViewState = "unseen" | "viewed" | "updated";

/** `updated` = marked viewed on an older head; new commits may have changed this file. */
export function fileViewState(marks: ViewedFileMarks, path: string, headSha: string): FileViewState {
    const viewedAt = marks[path];
    if (!viewedAt) {
        return "unseen";
    }
    if (!headSha || viewedAt === headSha) {
        return "viewed";
    }
    return "updated";
}

/**
 * Merge GitHub's per-file viewed state into local marks when opening a PR.
 * GitHub wins on conflict so marks from github.com or another client are reflected here.
 */
export function mergeViewedFileMarksFromGithub(
    local: ViewedFileMarks,
    files: ReadonlyArray<{ path: string; viewerViewedState?: GithubFileViewedState }>,
    headSha: string,
    baseSha: string,
): ViewedFileMarks {
    const next = { ...local };

    for (const file of files) {
        const state = file.viewerViewedState;
        if (!state) {
            continue;
        }

        switch (state) {
            case "VIEWED":
                if (headSha) {
                    next[file.path] = headSha;
                }
                break;
            case "DISMISSED": {
                const existing = next[file.path];
                if (existing && headSha && existing !== headSha) {
                    break;
                }
                next[file.path] = baseSha || existing || "dismissed";
                break;
            }
            case "UNVIEWED":
                delete next[file.path];
                break;
        }
    }

    return next;
}

/** @deprecated Prefer `readViewedFileMarks` — kept for any stray callers. */
export function readViewedPaths(repository: string, number: number, headSha: string): Set<string> {
    const marks = readViewedFileMarks(repository, number, headSha);
    return new Set(
        Object.entries(marks)
            .filter(([, sha]) => !headSha || sha === headSha)
            .map(([path]) => path),
    );
}

/** @deprecated Prefer `writeViewedFileMarks`. */
export function writeViewedPaths(repository: string, number: number, headSha: string, paths: Set<string>): void {
    const marks = readViewedFileMarks(repository, number, headSha);
    const next: ViewedFileMarks = { ...marks };
    for (const path of Object.keys(next)) {
        if (next[path] === headSha && !paths.has(path)) {
            delete next[path];
        }
    }
    for (const path of paths) {
        next[path] = headSha;
    }
    writeViewedFileMarks(repository, number, next);
}
