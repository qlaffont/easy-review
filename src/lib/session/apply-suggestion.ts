export type SuggestionChange = {
    path: string;
    /** 1-based inclusive start of the replaced range. */
    startLine: number;
    /** 1-based inclusive end of the replaced range. */
    endLine: number;
    /** Replacement text (no trailing fence). Empty string deletes the range. */
    replacement: string;
    /** Optional original text for an outdated check. */
    original?: string | null;
};

/** Replace an inclusive 1-based line range, preserving a trailing newline when present. */
export function replaceLines(content: string, startLine: number, endLine: number, replacement: string): string {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
        throw new Error("Invalid suggestion line range.");
    }

    if (content === "") {
        if (startLine !== 1 || endLine !== 1) {
            throw new Error("Suggestion is outside the file.");
        }
        const next = replacement.replace(/\n$/, "");
        return next.length === 0 ? "" : `${next}\n`;
    }

    const hadTrailingNewline = content.endsWith("\n");
    const lines = hadTrailingNewline ? content.slice(0, -1).split("\n") : content.split("\n");

    if (endLine > lines.length) {
        throw new Error("Suggestion is outside the file.");
    }

    const insert = replacement.replace(/\n$/, "");
    const insertLines = insert.length === 0 ? [] : insert.split("\n");
    lines.splice(startLine - 1, endLine - startLine + 1, ...insertLines);

    const body = lines.join("\n");
    return hadTrailingNewline ? `${body}\n` : body;
}

/** Verify the file still matches the suggestion's original span. */
export function assertSuggestionCurrent(
    content: string,
    startLine: number,
    endLine: number,
    original: string | null | undefined,
): void {
    if (original == null) {
        return;
    }
    if (content === "") {
        if (original.replace(/\n$/, "") !== "") {
            throw new Error("This suggestion is outdated.");
        }
        return;
    }

    const hadTrailingNewline = content.endsWith("\n");
    const lines = hadTrailingNewline ? content.slice(0, -1).split("\n") : content.split("\n");
    if (endLine > lines.length) {
        throw new Error("This suggestion is outdated.");
    }
    const current = lines.slice(startLine - 1, endLine).join("\n");
    if (current !== original.replace(/\n$/, "")) {
        throw new Error("This suggestion is outdated.");
    }
}

/**
 * Apply many suggestions to one file. Changes are applied bottom-to-top so earlier
 * line numbers stay valid.
 */
export function applySuggestionsToFile(content: string, changes: ReadonlyArray<SuggestionChange>): string {
    const ordered = [...changes].sort((a, b) => b.startLine - a.startLine);
    let next = content;
    for (const change of ordered) {
        assertSuggestionCurrent(next, change.startLine, change.endLine, change.original);
        next = replaceLines(next, change.startLine, change.endLine, change.replacement);
    }
    return next;
}

export function defaultSuggestionCommitMessage(paths: ReadonlyArray<string>): string {
    if (paths.length === 1) {
        return `Update ${paths[0]}`;
    }
    return `Apply ${paths.length} suggestions`;
}
