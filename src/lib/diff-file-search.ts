import type { DiffLayout } from "#/lib/diff-preferences.ts";
import type { DiffLine, DiffSide } from "#/lib/session/types.ts";
import type { DiffCodeSegment } from "#/lib/syntax/merge-syntax-word-diff.ts";

export type DiffSearchMatch = {
    id: number;
    lineIndex: number;
    /** `"both"` highlights context lines in split view on left and right. */
    side: DiffSide | "unified" | "both";
    start: number;
    end: number;
};

export type SearchHighlight = {
    start: number;
    end: number;
    active?: boolean;
};

export function findTextRanges(text: string, query: string): Array<{ start: number; end: number }> {
    const needle = query.trim();
    if (!needle) {
        return [];
    }

    const lower = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const ranges: Array<{ start: number; end: number }> = [];
    let from = 0;

    while (from < lower.length) {
        const index = lower.indexOf(lowerNeedle, from);
        if (index === -1) {
            break;
        }
        ranges.push({ start: index, end: index + needle.length });
        from = index + lowerNeedle.length;
    }

    return ranges;
}

export function collectDiffSearchMatches(
    lines: ReadonlyArray<DiffLine>,
    query: string,
    layout: DiffLayout,
): Array<DiffSearchMatch> {
    const needle = query.trim();
    if (!needle) {
        return [];
    }

    const matches: Array<DiffSearchMatch> = [];
    let id = 0;

    lines.forEach((line, lineIndex) => {
        if (line.kind === "hunk" || line.kind === "gap") {
            return;
        }

        const text = line.text ?? "";
        const ranges = findTextRanges(text, needle);
        if (ranges.length === 0) {
            return;
        }

        if (layout === "split") {
            if (line.kind === "context") {
                for (const range of ranges) {
                    matches.push({ id: id++, lineIndex, side: "both", ...range });
                }
                return;
            }
            const side: DiffSide = line.kind === "del" ? "LEFT" : "RIGHT";
            for (const range of ranges) {
                matches.push({ id: id++, lineIndex, side, ...range });
            }
            return;
        }

        for (const range of ranges) {
            matches.push({ id: id++, lineIndex, side: "unified", ...range });
        }
    });

    return matches;
}

export function searchHighlightsForCell(
    matches: ReadonlyArray<DiffSearchMatch>,
    activeMatchId: number,
    lineIndex: number,
    side: DiffSide | "unified",
): Array<SearchHighlight> {
    return matches
        .filter(
            (match) =>
                match.lineIndex === lineIndex &&
                (match.side === side || match.side === "both" || (match.side === "unified" && side === "unified")),
        )
        .map((match) => ({
            start: match.start,
            end: match.end,
            active: match.id === activeMatchId,
        }));
}

export function withSearchHighlights(
    segments: ReadonlyArray<DiffCodeSegment>,
    highlights: ReadonlyArray<SearchHighlight>,
): Array<DiffCodeSegment & { searchHit?: boolean; searchActive?: boolean }> {
    if (highlights.length === 0) {
        return segments.map((segment) => ({ ...segment }));
    }

    const text = segments.map((segment) => segment.value).join("");
    if (text.length === 0) {
        return segments.map((segment) => ({ ...segment }));
    }

    const boundaries = new Set<number>([0, text.length]);
    for (const highlight of highlights) {
        boundaries.add(Math.max(0, highlight.start));
        boundaries.add(Math.min(text.length, highlight.end));
    }

    const points = [...boundaries].sort((left, right) => left - right);
    const result: Array<DiffCodeSegment & { searchHit?: boolean; searchActive?: boolean }> = [];

    for (let index = 0; index < points.length - 1; index++) {
        const start = points[index]!;
        const end = points[index + 1]!;
        if (start >= end) {
            continue;
        }

        const sample = start;
        let offset = 0;
        let base: DiffCodeSegment | null = null;
        for (const segment of segments) {
            const segmentEnd = offset + segment.value.length;
            if (sample >= offset && sample < segmentEnd) {
                base = segment;
                break;
            }
            offset = segmentEnd;
        }

        if (!base) {
            continue;
        }

        const searchHit = highlights.some((highlight) => start < highlight.end && end > highlight.start);
        const searchActive = highlights.some(
            (highlight) => highlight.active && start >= highlight.start && end <= highlight.end,
        );

        result.push({
            ...base,
            value: text.slice(start, end),
            searchHit,
            searchActive,
        });
    }

    return result;
}
