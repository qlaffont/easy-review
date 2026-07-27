import { readGithubAccessToken } from "#/lib/github/auth-cookies.server.ts";

const GITHUB_API = "https://api.github.com";

const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "cookie",
    "authorization",
    "content-length",
    // Browser Accept-Encoding must not reach GitHub: Bun/fetch decompresses upstream
    // bodies but still exposes Content-Encoding, which would confuse the browser.
    "accept-encoding",
]);

/**
 * Dropped on the way back to the browser. `fetch` already delivers a decoded body, but
 * runtimes (Bun) may still advertise `content-encoding: gzip` — forwarding that makes the
 * browser try to gunzip plaintext and throw `TypeError: Decoding failed.`
 */
const STRIP_FROM_UPSTREAM_RESPONSE = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding"]);

function forwardRequestHeaders(request: Request): Headers {
    const headers = new Headers();

    request.headers.forEach((value, key) => {
        if (HOP_BY_HOP.has(key.toLowerCase())) {
            return;
        }

        headers.set(key, value);
    });

    if (!headers.has("accept")) {
        headers.set("accept", "application/vnd.github+json");
    }

    headers.set("user-agent", "easy-review");
    return headers;
}

function forwardResponseHeaders(upstream: Headers): Headers {
    const headers = new Headers();

    upstream.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (STRIP_FROM_UPSTREAM_RESPONSE.has(lower) || HOP_BY_HOP.has(lower)) {
            return;
        }

        headers.set(key, value);
    });

    return headers;
}

/**
 * Forwards a browser request to the GitHub API, attaching the OAuth access token from the
 * HTTP-only cookie. The client never sees client_secret or the access token.
 */
export async function proxyGithubRequest(request: Request, githubPath: string): Promise<Response> {
    const accessToken = readGithubAccessToken();

    if (!accessToken) {
        return Response.json({ message: "Not signed in with GitHub." }, { status: 401 });
    }

    const incoming = new URL(request.url);
    const path = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const target = new URL(`${GITHUB_API}${path}`);
    target.search = incoming.search;

    const headers = forwardRequestHeaders(request);
    headers.set("authorization", `Bearer ${accessToken}`);

    const method = request.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

    let upstream: Response;
    try {
        upstream = await fetch(target, { method, headers, body });
    } catch {
        return Response.json({ message: "Could not reach GitHub." }, { status: 502 });
    }

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: forwardResponseHeaders(upstream.headers),
    });
}
