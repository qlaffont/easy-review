import type { BundledLanguage, BundledTheme, Highlighter, ThemedToken } from "shiki";

import { languageFromPath } from "#/lib/syntax/language-from-path.ts";

export type SyntaxToken = {
    content: string;
    color?: string;
    fontStyle?: number;
    offset: number;
};

/** 1-based line number → tokens for that line (no trailing newline). */
export type SyntaxLineMap = ReadonlyMap<number, ReadonlyArray<SyntaxToken>>;

const MAX_HIGHLIGHT_CHARS = 400_000;

type ThemeId = "github-light" | "github-dark";

let highlighterPromise: Promise<Highlighter> | null = null;
const failedLanguages = new Set<string>();

/** Match `build-file-diff` splitting so line numbers align with diff rows. */
function splitLines(text: string): Array<string> {
    if (text.length === 0) {
        return [];
    }

    const parts = text.split("\n");
    return text.endsWith("\n") ? parts.slice(0, -1) : parts;
}

async function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
        highlighterPromise = import("shiki").then(({ createHighlighter }) =>
            createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }),
        );
    }
    return highlighterPromise;
}

function normalizeLineTokens(lineTokens: Array<ThemedToken>): Array<SyntaxToken> {
    let offset = 0;
    return lineTokens.map((token) => {
        const next: SyntaxToken = {
            content: token.content,
            color: token.color,
            fontStyle: token.fontStyle,
            offset,
        };
        offset += token.content.length;
        return next;
    });
}

function toLineMap(lines: Array<Array<ThemedToken>>, expectedCount: number): SyntaxLineMap {
    const map = new Map<number, ReadonlyArray<SyntaxToken>>();
    const count = Math.min(lines.length, expectedCount);
    for (let index = 0; index < count; index += 1) {
        map.set(index + 1, normalizeLineTokens(lines[index] ?? []));
    }
    return map;
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<boolean> {
    if (failedLanguages.has(lang)) {
        return false;
    }
    if (highlighter.getLoadedLanguages().includes(lang)) {
        return true;
    }
    try {
        await highlighter.loadLanguage(lang as BundledLanguage);
        return true;
    } catch {
        failedLanguages.add(lang);
        return false;
    }
}

/**
 * Tokenize a full file body for diff line lookup. Returns null when the path has no
 * language, the blob is too large, or highlighting fails.
 */
export async function highlightFileLines(
    path: string,
    text: string | null | undefined,
    dark: boolean,
): Promise<SyntaxLineMap | null> {
    if (!text || text.length > MAX_HIGHLIGHT_CHARS) {
        return null;
    }

    const lang = languageFromPath(path);
    if (!lang || lang === "plaintext") {
        return null;
    }

    const fileLines = splitLines(text);
    if (fileLines.length === 0) {
        return null;
    }

    const theme: ThemeId = dark ? "github-dark" : "github-light";

    try {
        const highlighter = await getHighlighter();
        if (!highlighter.getLoadedThemes().includes(theme)) {
            await highlighter.loadTheme(theme as BundledTheme);
        }
        if (!(await ensureLanguage(highlighter, lang))) {
            return null;
        }

        const { tokens } = highlighter.codeToTokens(fileLines.join("\n"), {
            lang: lang as BundledLanguage,
            theme,
        });
        return toLineMap(tokens, fileLines.length);
    } catch {
        return null;
    }
}
