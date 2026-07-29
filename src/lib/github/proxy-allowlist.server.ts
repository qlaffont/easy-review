/**
 * Paths and GraphQL operations Easy Review actually uses. Everything else is rejected so a
 * stolen session cookie cannot drive arbitrary GitHub API calls (delete repos, list all orgs, …).
 */

const GET = new Set(["GET", "HEAD"]);
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Rule = {
    methods: Set<string>;
    pattern: RegExp;
};

/** Repo-scoped REST surfaces used by `createGithubHttpClient`. */
const REST_RULES: Array<Rule> = [
    /** Resolve `user-attachments` media to signed CDN URLs (images/videos in comments). */
    { methods: new Set(["POST"]), pattern: /^\/markdown$/ },
    /** GitHub App: list installations + repos the user token can see (org + personal). */
    { methods: GET, pattern: /^\/user\/installations$/ },
    { methods: GET, pattern: /^\/user\/installations\/\d+\/repositories$/ },
    /** Legacy personal-repo listing (kept for older sessions / tests). */
    { methods: GET, pattern: /^\/user\/repos$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/assignees$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/labels$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/branches$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/rules\/branches\/[^/]+$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/contents\/.+$/ },
    /** Commit-range file list for the Files changed “Changes from” picker. */
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/compare\/[^/]+$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/ },
    { methods: new Set(["PUT"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/ },
    { methods: new Set(["PATCH"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/reactions$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/reactions$/ },
    { methods: new Set(["DELETE"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/reactions\/\d+$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/\d+\/reactions$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/\d+\/reactions$/ },
    { methods: new Set(["DELETE"]), pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/\d+\/reactions\/\d+$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/ },
    {
        methods: new Set(["PUT"]),
        pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews\/\d+\/dismissals$/,
    },
    { methods: new Set(["POST", "DELETE"]), pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/requested_reviewers$/ },
    { methods: new Set(["PUT"]), pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge$/ },
    { methods: new Set(["PATCH"]), pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/ },
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/git\/commits\/[^/]+$/ },
    /** Media upload + apply-suggestions: read/create/update git objects and refs. */
    { methods: GET, pattern: /^\/repos\/[^/]+\/[^/]+\/git\/ref\/.+$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/git\/blobs$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/git\/trees$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/git\/commits$/ },
    { methods: new Set(["POST"]), pattern: /^\/repos\/[^/]+\/[^/]+\/git\/refs$/ },
    { methods: new Set(["PATCH"]), pattern: /^\/repos\/[^/]+\/[^/]+\/git\/refs\/.+$/ },
];

const NAMED_OPERATION = /\b(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

/** Strip `#` line comments and `"..."` / `'...'` string literals so names inside strings don't count. */
function stripGraphqlNoise(source: string): string {
    return source.replace(/#[^\n\r]*/g, " ").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

/**
 * Only named `EasyReview*` operations (see `github-http-client.ts`) may go through the proxy.
 * Anonymous operations and foreign names are rejected.
 */
export function isAllowedGraphqlQuery(query: string): boolean {
    const names = [...stripGraphqlNoise(query).matchAll(NAMED_OPERATION)].map((match) => match[1]!);

    if (names.length === 0) {
        return false;
    }

    return names.every((name) => name.startsWith("EasyReview"));
}

function normalizeProxyPath(githubPath: string): string | null {
    const withSlash = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const pathOnly = withSlash.split("?")[0] ?? withSlash;

    // Reject traversal / odd separators. Do not treat `...` inside a compare ref
    // (`/compare/abc...def`) as `..` — that is a single path segment.
    if (pathOnly.includes("//") || pathOnly.includes("\\")) {
        return null;
    }
    if (pathOnly.split("/").some((segment) => segment === ".." || segment === ".")) {
        return null;
    }

    try {
        // Resolve `.` segments without leaving api.github.com (pathname-only URL).
        const resolved = new URL(pathOnly, "https://api.github.com");
        if (resolved.origin !== "https://api.github.com") {
            return null;
        }
        return resolved.pathname;
    } catch {
        return null;
    }
}

function isAllowedRestPath(method: string, path: string): boolean {
    return REST_RULES.some((rule) => rule.methods.has(method) && rule.pattern.test(path));
}

/**
 * Returns true when this proxied call matches an allowlisted REST path or an EasyReview GraphQL op.
 * `body` is the raw request body (already buffered by the proxy).
 */
export function isAllowedGithubProxyRequest(
    method: string,
    githubPath: string,
    body: ArrayBuffer | undefined,
): boolean {
    const normalizedMethod = method.toUpperCase();
    const path = normalizeProxyPath(githubPath);

    if (!path) {
        return false;
    }

    if (path === "/graphql") {
        if (normalizedMethod !== "POST" || body == null) {
            return false;
        }

        try {
            const payload = JSON.parse(new TextDecoder().decode(body)) as { query?: unknown };
            return typeof payload.query === "string" && isAllowedGraphqlQuery(payload.query);
        } catch {
            return false;
        }
    }

    if (WRITE.has(normalizedMethod) || GET.has(normalizedMethod)) {
        return isAllowedRestPath(normalizedMethod, path);
    }

    return false;
}
