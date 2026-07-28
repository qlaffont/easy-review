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

type ShikiToken = {
    content: string;
    color?: string;
    fontStyle?: number;
};

type ShikiHighlighter = {
    getLoadedLanguages: () => Array<string>;
    getLoadedThemes: () => Array<string>;
    loadLanguage: (lang: unknown) => Promise<unknown>;
    loadTheme: (theme: unknown) => Promise<unknown>;
    codeToTokens: (code: string, options: { lang: string; theme: string }) => { tokens: Array<Array<ShikiToken>> };
};

/**
 * Explicit loaders so Vite only emits chunks for languages we actually support —
 * importing `shiki`’s full registry ships every TextMate grammar into `.output/public`.
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
    bash: () => import("shiki/langs/bash.mjs"),
    css: () => import("shiki/langs/css.mjs"),
    dockerfile: () => import("shiki/langs/dockerfile.mjs"),
    dotenv: () => import("shiki/langs/dotenv.mjs"),
    go: () => import("shiki/langs/go.mjs"),
    graphql: () => import("shiki/langs/graphql.mjs"),
    html: () => import("shiki/langs/html.mjs"),
    java: () => import("shiki/langs/java.mjs"),
    javascript: () => import("shiki/langs/javascript.mjs"),
    json: () => import("shiki/langs/json.mjs"),
    jsonc: () => import("shiki/langs/jsonc.mjs"),
    jsx: () => import("shiki/langs/jsx.mjs"),
    kotlin: () => import("shiki/langs/kotlin.mjs"),
    markdown: () => import("shiki/langs/markdown.mjs"),
    php: () => import("shiki/langs/php.mjs"),
    python: () => import("shiki/langs/python.mjs"),
    rust: () => import("shiki/langs/rust.mjs"),
    scss: () => import("shiki/langs/scss.mjs"),
    sql: () => import("shiki/langs/sql.mjs"),
    svelte: () => import("shiki/langs/svelte.mjs"),
    swift: () => import("shiki/langs/swift.mjs"),
    toml: () => import("shiki/langs/toml.mjs"),
    tsx: () => import("shiki/langs/tsx.mjs"),
    typescript: () => import("shiki/langs/typescript.mjs"),
    vue: () => import("shiki/langs/vue.mjs"),
    xml: () => import("shiki/langs/xml.mjs"),
    yaml: () => import("shiki/langs/yaml.mjs"),
};

let highlighterPromise: Promise<ShikiHighlighter> | null = null;
const failedLanguages = new Set<string>();

/** Match `build-file-diff` splitting so line numbers align with diff rows. */
function splitLines(text: string): Array<string> {
    if (text.length === 0) {
        return [];
    }

    const parts = text.split("\n");
    return text.endsWith("\n") ? parts.slice(0, -1) : parts;
}

async function getHighlighter(): Promise<ShikiHighlighter> {
    if (!highlighterPromise) {
        highlighterPromise = (async () => {
            const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
                import("shiki/core"),
                import("shiki/engine/javascript"),
            ]);

            return createHighlighterCore({
                themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
                langs: [],
                engine: createJavaScriptRegexEngine(),
            }) as Promise<ShikiHighlighter>;
        })();
    }
    return highlighterPromise;
}

function normalizeLineTokens(lineTokens: Array<ShikiToken>): Array<SyntaxToken> {
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

function toLineMap(lines: Array<Array<ShikiToken>>, expectedCount: number): SyntaxLineMap {
    const map = new Map<number, ReadonlyArray<SyntaxToken>>();
    const count = Math.min(lines.length, expectedCount);
    for (let index = 0; index < count; index += 1) {
        map.set(index + 1, normalizeLineTokens(lines[index] ?? []));
    }
    return map;
}

async function ensureLanguage(highlighter: ShikiHighlighter, lang: string): Promise<boolean> {
    if (failedLanguages.has(lang)) {
        return false;
    }
    if (highlighter.getLoadedLanguages().includes(lang)) {
        return true;
    }

    const loader = LANGUAGE_LOADERS[lang];
    if (!loader) {
        failedLanguages.add(lang);
        return false;
    }

    try {
        await highlighter.loadLanguage(loader());
        return true;
    } catch {
        failedLanguages.add(lang);
        return false;
    }
}

/**
 * Tokenize a full file body for diff line lookup. Returns null when the path has no
 * language, the blob is too large, highlighting fails, or we are not in a browser.
 */
export async function highlightFileLines(
    path: string,
    text: string | null | undefined,
    dark: boolean,
): Promise<SyntaxLineMap | null> {
    if (typeof window === "undefined") {
        return null;
    }

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
            await highlighter.loadTheme(
                theme === "github-dark"
                    ? import("shiki/themes/github-dark.mjs")
                    : import("shiki/themes/github-light.mjs"),
            );
        }
        if (!(await ensureLanguage(highlighter, lang))) {
            return null;
        }

        const { tokens } = highlighter.codeToTokens(fileLines.join("\n"), {
            lang,
            theme,
        });
        return toLineMap(tokens, fileLines.length);
    } catch {
        return null;
    }
}
