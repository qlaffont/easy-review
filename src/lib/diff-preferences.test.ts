import { afterEach, describe, expect, it } from "vitest";

import {
    fileViewState,
    mergeViewedFileMarksFromGithub,
    readViewedFileMarks,
    viewedFileMarksStorageKey,
    viewedFilesStorageKey,
    writeViewedFileMarks,
} from "#/lib/diff-preferences.ts";

const memory = new Map<string, string>();

const localStorageMock = {
    getItem(key: string) {
        return memory.has(key) ? memory.get(key)! : null;
    },
    setItem(key: string, value: string) {
        memory.set(key, value);
    },
    removeItem(key: string) {
        memory.delete(key);
    },
    clear() {
        memory.clear();
    },
};

Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
});

Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
});

afterEach(() => {
    memory.clear();
});

describe("fileViewState", () => {
    it("treats missing marks as unseen", () => {
        expect(fileViewState({}, "a.ts", "sha1")).toBe("unseen");
    });

    it("treats matching head as viewed", () => {
        expect(fileViewState({ "a.ts": "sha1" }, "a.ts", "sha1")).toBe("viewed");
    });

    it("treats older head as updated since viewed", () => {
        expect(fileViewState({ "a.ts": "sha1" }, "a.ts", "sha2")).toBe("updated");
    });
});

describe("mergeViewedFileMarksFromGithub", () => {
    it("marks GitHub VIEWED files with the current head", () => {
        expect(
            mergeViewedFileMarksFromGithub({}, [{ path: "a.ts", viewerViewedState: "VIEWED" }], "head", "base"),
        ).toEqual({ "a.ts": "head" });
    });

    it("clears local marks when GitHub reports UNVIEWED", () => {
        expect(
            mergeViewedFileMarksFromGithub(
                { "a.ts": "head" },
                [{ path: "a.ts", viewerViewedState: "UNVIEWED" }],
                "head",
                "base",
            ),
        ).toEqual({});
    });

    it("maps DISMISSED to an older sha for updated state", () => {
        const marks = mergeViewedFileMarksFromGithub(
            {},
            [{ path: "a.ts", viewerViewedState: "DISMISSED" }],
            "head",
            "base",
        );
        expect(fileViewState(marks, "a.ts", "head")).toBe("updated");
    });
});

describe("readViewedFileMarks", () => {
    it("persists path→sha marks across head changes", () => {
        writeViewedFileMarks("acme/api", 1, { "src/a.ts": "aaa" });

        expect(readViewedFileMarks("acme/api", 1, "bbb")).toEqual({ "src/a.ts": "aaa" });
        expect(fileViewState(readViewedFileMarks("acme/api", 1, "bbb"), "src/a.ts", "bbb")).toBe("updated");
    });

    it("migrates legacy v1 path lists for the current head", () => {
        localStorage.setItem(viewedFilesStorageKey("acme/api", 2, "head"), JSON.stringify(["x.ts", "y.ts"]));

        expect(readViewedFileMarks("acme/api", 2, "head")).toEqual({
            "x.ts": "head",
            "y.ts": "head",
        });
        expect(localStorage.getItem(viewedFileMarksStorageKey("acme/api", 2))).toBeTruthy();
    });
});
