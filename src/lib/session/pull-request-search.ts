import type { PullRequestSummary } from "#/lib/session/types.ts";

export type ParsedPullRequestRef = {
    repository: string;
    number: number;
};

/**
 * Palette / GitHub search: match when the query is contained in the title, head branch,
 * pull request number (also accepts a leading `#`), or a pasted GitHub PR URL.
 */
export function matchesPullRequestSearchQuery(
    pullRequest: Pick<PullRequestSummary, "title" | "headRefName" | "number" | "repository" | "url" | "key">,
    query: string,
): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return false;
    }

    const link = parseGitHubPullRequestUrl(query);
    if (link) {
        return (
            pullRequest.repository.toLowerCase() === link.repository.toLowerCase() && pullRequest.number === link.number
        );
    }

    if (
        pullRequest.title.toLowerCase().includes(needle) ||
        pullRequest.headRefName.toLowerCase().includes(needle) ||
        pullRequest.url.toLowerCase().includes(needle) ||
        pullRequest.key.toLowerCase().includes(needle)
    ) {
        return true;
    }

    const digits = needle.startsWith("#") ? needle.slice(1) : needle;
    if (!/^\d+$/.test(digits)) {
        return false;
    }

    return String(pullRequest.number).includes(digits);
}

/** Newest first. */
export function comparePullRequestsByUpdatedAtDesc(
    left: Pick<PullRequestSummary, "updatedAt">,
    right: Pick<PullRequestSummary, "updatedAt">,
): number {
    return right.updatedAt.localeCompare(left.updatedAt);
}

/** Parse `#123` / `123` into a PR number, or null when the query is not a bare number. */
export function parsePullRequestNumberQuery(query: string): number | null {
    const match = /^#?(\d+)$/.exec(query.trim());
    if (!match) {
        return null;
    }
    const number = Number(match[1]);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Parse a GitHub pull request URL (`https://github.com/owner/repo/pull/123`, with or without
 * scheme / trailing path). Returns null when the query is not a PR link.
 */
export function parseGitHubPullRequestUrl(query: string): ParsedPullRequestRef | null {
    const trimmed = query.trim();
    if (!trimmed) {
        return null;
    }

    const match =
        /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/[^\s]*)?(?:\?[^\s]*)?(?:#[^\s]*)?$/i.exec(
            trimmed,
        );
    if (!match) {
        return null;
    }

    const owner = match[1];
    const repo = match[2];
    const number = Number(match[3]);
    if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) {
        return null;
    }

    return { repository: `${owner}/${repo}`, number };
}
