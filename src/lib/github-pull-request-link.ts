const OWNER_RE = /^[a-zA-Z\d](?:[a-zA-Z\d-]{0,38})$/;
const REPO_RE = /^[\w.-]{1,100}$/;
const DOT_SEGMENT_RE = /^\.{1,2}$/;

export type PullRequestLinkTarget = { owner: string; repo: string; number: string };

/**
 * `https://github.com/{owner}/{repo}/pull/{n}` (query / fragment ignored) → route params for the
 * Easy Review pull request page. Anything deeper (`/files`, `/commits/…`) or off github.com stays
 * a GitHub link. Dot-segment repo names are refused so the route path cannot walk up.
 */
export function pullRequestLinkTarget(href: string | undefined): PullRequestLinkTarget | null {
    if (!href) {
        return null;
    }

    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "github.com" && host !== "www.github.com")) {
        return null;
    }

    const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
    if (parts.length !== 4 || parts[2] !== "pull") {
        return null;
    }

    const [owner = "", repo = "", , number = ""] = parts;
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || DOT_SEGMENT_RE.test(repo) || !/^[1-9]\d{0,9}$/.test(number)) {
        return null;
    }

    return { owner, repo, number };
}
