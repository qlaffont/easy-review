import type { DiffSide } from "#/lib/session/types.ts";

import { cn } from "#/lib/utils.ts";

type HunkLine = {
    kind: "add" | "del" | "context";
    text: string;
    oldNumber: number | null;
    newNumber: number | null;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Keep conversation snippets short — GitHub’s thread UI shows a handful of lines, not the whole hunk. */
const MAX_PREVIEW_LINES = 6;
const CONTEXT_BEFORE = 4;

/** Parse GitHub `diffHunk` text into numbered add/del/context rows. */
export function parseDiffHunk(hunk: string): Array<HunkLine> {
    const rows: Array<HunkLine> = [];
    let oldLine = 0;
    let newLine = 0;

    for (const raw of hunk.replace(/\r\n/g, "\n").split("\n")) {
        if (!raw) {
            continue;
        }

        const header = HUNK_HEADER.exec(raw);
        if (header) {
            oldLine = Number(header[1]);
            newLine = Number(header[2]);
            continue;
        }

        const marker = raw[0];
        const text = raw.slice(1);
        if (marker === "+") {
            rows.push({ kind: "add", text, oldNumber: null, newNumber: newLine });
            newLine += 1;
            continue;
        }
        if (marker === "-") {
            rows.push({ kind: "del", text, oldNumber: oldLine, newNumber: null });
            oldLine += 1;
            continue;
        }
        if (marker === "\\") {
            // "\ No newline at end of file"
            continue;
        }

        // Context lines may be prefixed with a space, or rarely arrive bare.
        const contextText = marker === " " ? text : raw;
        rows.push({ kind: "context", text: contextText, oldNumber: oldLine, newNumber: newLine });
        oldLine += 1;
        newLine += 1;
    }

    return rows;
}

/**
 * Lines a ` ```suggestion ` block replaces, taken from the review comment hunk.
 * Uses the thread’s start/end line on the annotated side (RIGHT = head file).
 */
export function suggestionOriginalFromHunk(
    hunk: string | null | undefined,
    startLine: number | null | undefined,
    endLine: number | null | undefined,
    side: DiffSide | null | undefined,
): string | null {
    if (!hunk || endLine == null) {
        return null;
    }

    const lines = parseDiffHunk(hunk);
    if (lines.length === 0) {
        return null;
    }

    const useNew = side !== "LEFT";
    const start = startLine ?? endLine;
    const range: Array<string> = [];

    for (const row of lines) {
        const number = useNew ? row.newNumber : row.oldNumber;
        if (number == null || number < start || number > endLine) {
            continue;
        }
        if (useNew && (row.kind === "add" || row.kind === "context")) {
            range.push(row.text);
            continue;
        }
        if (!useNew && (row.kind === "del" || row.kind === "context")) {
            range.push(row.text);
        }
    }

    return range.length > 0 ? range.join("\n") : null;
}

/** Slice the hunk down to a small window around the commented line. */
export function trimHunkToFocus(
    lines: Array<HunkLine>,
    focusLine: number | null,
    side: DiffSide | null,
): Array<HunkLine> {
    if (lines.length <= MAX_PREVIEW_LINES) {
        return lines;
    }

    const useNew = side !== "LEFT";
    let focusIndex = lines.length - 1;
    if (focusLine != null) {
        const matched = lines.findIndex((line) =>
            useNew ? line.newNumber === focusLine : line.oldNumber === focusLine,
        );
        if (matched >= 0) {
            focusIndex = matched;
        }
    }

    let start = Math.max(0, focusIndex - CONTEXT_BEFORE);
    let end = focusIndex + 1;
    if (end - start > MAX_PREVIEW_LINES) {
        start = end - MAX_PREVIEW_LINES;
    }
    if (end - start < MAX_PREVIEW_LINES && start > 0) {
        start = Math.max(0, end - MAX_PREVIEW_LINES);
    }

    return lines.slice(start, end);
}

/** Compact read-only code snippet for a review thread (conversation + inline). */
export function DiffHunkPreview({
    hunk,
    focusLine = null,
    side = null,
    className,
}: {
    hunk: string;
    /** Anchor line from the review thread — trims oversized hunks around this line. */
    focusLine?: number | null;
    side?: DiffSide | null;
    className?: string;
}) {
    const lines = trimHunkToFocus(parseDiffHunk(hunk), focusLine, side);
    if (lines.length === 0) {
        return null;
    }

    return (
        <div className={cn("overflow-x-auto border-y bg-muted/10 font-mono text-[12px] leading-5", className)}>
            <table className="w-full border-collapse">
                <tbody>
                    {lines.map((line, index) => (
                        <tr
                            key={`${line.kind}-${line.oldNumber ?? "x"}-${line.newNumber ?? "x"}-${index}`}
                            className={cn(
                                line.kind === "add" && "bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
                                line.kind === "del" && "bg-red-500/10 text-red-950 dark:text-red-100",
                            )}
                        >
                            <td className="w-10 select-none px-2 text-right text-muted-foreground tabular-nums">
                                {line.oldNumber ?? ""}
                            </td>
                            <td className="w-10 select-none px-2 text-right text-muted-foreground tabular-nums">
                                {line.newNumber ?? ""}
                            </td>
                            <td
                                className={cn(
                                    "w-4 select-none px-1 text-center",
                                    line.kind === "add" && "text-emerald-700 dark:text-emerald-300",
                                    line.kind === "del" && "text-red-700 dark:text-red-300",
                                )}
                            >
                                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                            </td>
                            <td className="whitespace-pre px-2">{line.text}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
