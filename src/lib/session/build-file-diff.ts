import { diffLines } from "diff";

import type { DiffLine, FileDiff, FileStubReason } from "#/lib/session/types.ts";

import { MAX_RENDERED_DIFF_LINES, stubForBlob } from "#/lib/session/diff-policy.ts";

export type FileSides = {
    path: string;
    /** Missing when the file was added. */
    before: Uint8Array | null;
    /** Missing when the file was removed. */
    after: Uint8Array | null;
};

function decodeText(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function splitLines(text: string): Array<string> {
    if (text.length === 0) {
        return [];
    }

    const parts = text.split("\n");
    return text.endsWith("\n") ? parts.slice(0, -1) : parts;
}

/**
 * Turn the two sides of a change into numbered diff lines. Binary / huge decisions happen here
 * so every adapter (HTTP, fake) shares one policy.
 */
export function buildFileDiff(sides: FileSides, { force = false }: { force?: boolean } = {}): FileDiff {
    for (const side of [sides.after, sides.before]) {
        if (!side) {
            continue;
        }

        const stub = stubForBlob(side, force);

        if (stub) {
            return emptyDiff(sides.path, stub);
        }
    }

    const beforeText = sides.before ? decodeText(sides.before) : "";
    const afterText = sides.after ? decodeText(sides.after) : "";
    const lines = toDiffLines(beforeText, afterText);
    const truncated = lines.length > MAX_RENDERED_DIFF_LINES;

    return {
        path: sides.path,
        lines: truncated ? lines.slice(0, MAX_RENDERED_DIFF_LINES) : lines,
        truncated,
        stub: null,
    };
}

function emptyDiff(path: string, stub: FileStubReason | null): FileDiff {
    return { path, lines: [], truncated: false, stub };
}

function toDiffLines(before: string, after: string): Array<DiffLine> {
    const changes = diffLines(before, after);
    const lines: Array<DiffLine> = [];
    let oldNumber = 1;
    let newNumber = 1;
    let hunkOldStart = 1;
    let hunkNewStart = 1;
    let hunkOldCount = 0;
    let hunkNewCount = 0;
    let hunkBody: Array<DiffLine> = [];

    function flush() {
        if (hunkBody.length === 0) {
            return;
        }

        lines.push({
            kind: "hunk",
            text: `@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
            oldNumber: null,
            newNumber: null,
        });
        lines.push(...hunkBody);
        hunkBody = [];
        hunkOldCount = 0;
        hunkNewCount = 0;
    }

    for (const change of changes) {
        const chunk = splitLines(change.value);

        if (!change.added && !change.removed) {
            // Unchanged region: close the open hunk, then skip ahead. Review density beats a
            // full-file dump of context around every edit.
            flush();
            oldNumber += chunk.length;
            newNumber += chunk.length;
            continue;
        }

        if (hunkBody.length === 0) {
            hunkOldStart = oldNumber;
            hunkNewStart = newNumber;
        }

        if (change.added) {
            for (const text of chunk) {
                hunkBody.push({ kind: "add", text, oldNumber: null, newNumber: newNumber++ });
                hunkNewCount++;
            }
        } else {
            for (const text of chunk) {
                hunkBody.push({ kind: "del", text, oldNumber: oldNumber++, newNumber: null });
                hunkOldCount++;
            }
        }
    }

    flush();
    return lines;
}
