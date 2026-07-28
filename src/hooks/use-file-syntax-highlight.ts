import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { highlightFileLines, type SyntaxLineMap, type SyntaxToken } from "#/lib/syntax/highlight-file.ts";
import { isDarkScheme } from "#/lib/theme.ts";

export type FileSyntaxMaps = {
    before: SyntaxLineMap | null;
    after: SyntaxLineMap | null;
};

const EMPTY: FileSyntaxMaps = { before: null, after: null };

/** Highlight before/after blobs for a diff path; maps are keyed by 1-based line numbers. */
export function useFileSyntaxHighlight(
    path: string,
    beforeText: string | null | undefined,
    afterText: string | null | undefined,
): FileSyntaxMaps {
    const { theme, resolvedTheme } = useTheme();
    const dark = isDarkScheme(resolvedTheme ?? theme);
    const [maps, setMaps] = useState<FileSyntaxMaps>(EMPTY);

    useEffect(() => {
        let cancelled = false;
        setMaps(EMPTY);

        void (async () => {
            const [before, after] = await Promise.all([
                highlightFileLines(path, beforeText, dark),
                highlightFileLines(path, afterText, dark),
            ]);
            if (!cancelled) {
                setMaps({ before, after });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [path, beforeText, afterText, dark]);

    return maps;
}

export function tokensForDiffLine(
    maps: FileSyntaxMaps,
    kind: "context" | "add" | "del" | "hunk" | "gap",
    oldNumber: number | null,
    newNumber: number | null,
): ReadonlyArray<SyntaxToken> | null {
    if (kind === "add") {
        return (newNumber != null ? maps.after?.get(newNumber) : null) ?? null;
    }
    if (kind === "del") {
        return (oldNumber != null ? maps.before?.get(oldNumber) : null) ?? null;
    }
    if (kind === "context") {
        return (
            (newNumber != null ? maps.after?.get(newNumber) : null) ??
            (oldNumber != null ? maps.before?.get(oldNumber) : null) ??
            null
        );
    }
    return null;
}
