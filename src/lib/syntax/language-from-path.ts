/** Map a file path to a Shiki language id we ship, or null when unknown / unsupported. */
const EXT_TO_LANG: Record<string, string> = {
    bash: "bash",
    cjs: "javascript",
    css: "css",
    cts: "typescript",
    dockerfile: "dockerfile",
    go: "go",
    gql: "graphql",
    graphql: "graphql",
    html: "html",
    htm: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsonc: "jsonc",
    jsx: "jsx",
    kt: "kotlin",
    kts: "kotlin",
    md: "markdown",
    mjs: "javascript",
    mts: "typescript",
    php: "php",
    py: "python",
    rs: "rust",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    svelte: "svelte",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
};

const FILENAME_TO_LANG: Record<string, string> = {
    dockerfile: "dockerfile",
    ".env": "dotenv",
    ".env.example": "dotenv",
    ".env.local": "dotenv",
};

export function languageFromPath(path: string): string | null {
    const base = path.split("/").pop() ?? path;
    const lower = base.toLowerCase();

    const byName = FILENAME_TO_LANG[lower];
    if (byName) {
        return byName;
    }

    const dot = lower.lastIndexOf(".");
    if (dot <= 0 || dot === lower.length - 1) {
        return null;
    }

    return EXT_TO_LANG[lower.slice(dot + 1)] ?? null;
}
