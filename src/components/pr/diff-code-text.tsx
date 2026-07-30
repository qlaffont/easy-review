import type { Change } from "diff";

import type { SearchHighlight } from "#/lib/diff-file-search.ts";
import type { SyntaxToken } from "#/lib/syntax/highlight-file.ts";

import { withSearchHighlights } from "#/lib/diff-file-search.ts";
import { mergeSyntaxWithWordDiff } from "#/lib/syntax/merge-syntax-word-diff.ts";
import { cn } from "#/lib/utils.ts";

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

/** Renders one diff line of code with optional Shiki colors and word-diff chips. */
export function DiffCodeText({
    text,
    tokens,
    wordParts,
    side,
    searchHighlights,
}: {
    text: string;
    tokens?: ReadonlyArray<SyntaxToken> | null;
    wordParts?: Array<Change> | null;
    side?: "add" | "del";
    searchHighlights?: ReadonlyArray<SearchHighlight>;
}) {
    const segments = withSearchHighlights(
        mergeSyntaxWithWordDiff(text, tokens, wordParts ?? null, side ?? "add"),
        searchHighlights ?? [],
    );

    return (
        <>
            {segments.map((segment, index) => (
                <span
                    key={index}
                    className={cn(
                        segment.highlight &&
                            (side === "del"
                                ? "rounded-[2px] bg-red-600/20 box-decoration-clone dark:bg-red-400/25"
                                : "rounded-[2px] bg-emerald-600/20 box-decoration-clone dark:bg-emerald-400/25"),
                        segment.searchActive &&
                            "rounded-[2px] bg-amber-400/80 box-decoration-clone ring-1 ring-amber-600 dark:bg-amber-500/60",
                        segment.searchHit &&
                            !segment.searchActive &&
                            "rounded-[2px] bg-amber-200/90 box-decoration-clone dark:bg-amber-400/35",
                    )}
                    style={{
                        color: segment.color,
                        fontStyle: segment.fontStyle && segment.fontStyle & FONT_STYLE_ITALIC ? "italic" : undefined,
                        fontWeight: segment.fontStyle && segment.fontStyle & FONT_STYLE_BOLD ? 600 : undefined,
                        textDecoration:
                            segment.fontStyle && segment.fontStyle & FONT_STYLE_UNDERLINE ? "underline" : undefined,
                    }}
                >
                    {segment.value}
                </span>
            ))}
        </>
    );
}
