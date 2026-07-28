/** Map a file path to a Shiki bundled language id, or null when unknown. */
const EXT_TO_LANG: Record<string, string> = {
    as: "actionscript-3",
    bash: "bash",
    c: "c",
    cc: "cpp",
    cjs: "javascript",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    cts: "typescript",
    cxx: "cpp",
    dart: "dart",
    dockerfile: "dockerfile",
    env: "dotenv",
    ex: "elixir",
    exs: "elixir",
    fs: "fsharp",
    fsx: "fsharp",
    go: "go",
    gql: "graphql",
    graphql: "graphql",
    groovy: "groovy",
    h: "c",
    hpp: "cpp",
    hs: "haskell",
    html: "html",
    htm: "html",
    java: "java",
    jl: "julia",
    js: "javascript",
    json: "json",
    jsonc: "jsonc",
    jsx: "jsx",
    kt: "kotlin",
    kts: "kotlin",
    less: "less",
    lua: "lua",
    m: "objective-c",
    md: "markdown",
    mdx: "mdx",
    mjs: "javascript",
    mm: "objective-cpp",
    mts: "typescript",
    php: "php",
    pl: "perl",
    pm: "perl",
    proto: "proto",
    py: "python",
    r: "r",
    rb: "ruby",
    rs: "rust",
    scala: "scala",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    svelte: "svelte",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    txt: "plaintext",
    vue: "vue",
    wasm: "wasm",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zig: "zig",
    zsh: "bash",
};

const FILENAME_TO_LANG: Record<string, string> = {
    dockerfile: "dockerfile",
    gemfile: "ruby",
    makefile: "makefile",
    rakefile: "ruby",
    "cmakelists.txt": "cmake",
    ".env": "dotenv",
    ".env.example": "dotenv",
    ".env.local": "dotenv",
    ".gitignore": "plaintext",
    ".npmrc": "ini",
    ".nvmrc": "plaintext",
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
