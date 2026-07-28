import type { Change } from "diff";

import type { SyntaxToken } from "#/lib/syntax/highlight-file.ts";

export type DiffCodeSegment = {
    value: string;
    color?: string;
    fontStyle?: number;
    highlight: boolean;
};

function highlightRanges(parts: Array<Change>, side: "add" | "del"): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    let offset = 0;

    for (const part of parts) {
        if (side === "del" && part.added) {
            continue;
        }
        if (side === "add" && part.removed) {
            continue;
        }

        const length = part.value.length;
        const highlight = (side === "del" && Boolean(part.removed)) || (side === "add" && Boolean(part.added));
        if (highlight && length > 0) {
            ranges.push({ start: offset, end: offset + length });
        }
        offset += length;
    }

    return ranges;
}

function tokenCovering(tokens: ReadonlyArray<SyntaxToken>, index: number): SyntaxToken | undefined {
    for (const token of tokens) {
        if (index >= token.offset && index < token.offset + token.content.length) {
            return token;
        }
    }
    return undefined;
}

/**
 * Merge Shiki tokens with word-diff ranges so syntax colors survive inline change chips.
 */
export function mergeSyntaxWithWordDiff(
    text: string,
    tokens: ReadonlyArray<SyntaxToken> | null | undefined,
    wordParts: Array<Change> | null | undefined,
    side: "add" | "del",
): Array<DiffCodeSegment> {
    const highlights = wordParts ? highlightRanges(wordParts, side) : [];
    const joined = tokens?.map((token) => token.content).join("") ?? "";
    const usableTokens = tokens && joined === text ? tokens : null;

    if (!usableTokens && highlights.length === 0) {
        return text ? [{ value: text, highlight: false }] : [];
    }

    const cuts = new Set<number>([0, text.length]);
    if (usableTokens) {
        for (const token of usableTokens) {
            cuts.add(token.offset);
            cuts.add(token.offset + token.content.length);
        }
    }
    for (const range of highlights) {
        cuts.add(range.start);
        cuts.add(range.end);
    }

    const points = [...cuts].sort((a, b) => a - b);
    const segments: Array<DiffCodeSegment> = [];

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index]!;
        const end = points[index + 1]!;
        if (start >= end) {
            continue;
        }

        const token = usableTokens ? tokenCovering(usableTokens, start) : undefined;
        const highlight = highlights.some((range) => start >= range.start && start < range.end);

        segments.push({
            value: text.slice(start, end),
            color: token?.color,
            fontStyle: token?.fontStyle,
            highlight,
        });
    }

    return segments;
}
