import type { Link, Root } from "mdast";

import { findAndReplace } from "mdast-util-find-and-replace";

/**
 * `owner/repo#123` or bare `#123`. The lookbehind keeps `abc#1`, `path/#1` and URL fragments
 * out, as GitHub does; `\b` after the digits rejects `#12abc`.
 */
const REFERENCE_RE = /(?<![\w./#-])(?:([a-zA-Z\d](?:[a-zA-Z\d-]{0,38}))\/([\w.-]{1,100}))?#(\d+)\b/g;

/** `.` / `..` are not valid repository names; in a URL they would walk up the GitHub path. */
const DOT_SEGMENT_RE = /^\.{1,2}$/;

export type GithubReferencesOptions = {
    /** `owner/repo` that bare `#123` points at; bare references stay text without it. */
    repository?: string | null;
};

/**
 * Link issue / pull request references the way GitHub renders them. They point at `/pull/N`, which
 * the markdown `a` renderer opens in Easy Review: most references in a PR body are pull requests,
 * and the markdown alone cannot tell them from issues. An issue number lands on the PR page’s
 * error state, which links back to the issue on GitHub (and GitHub itself redirects `/pull/N`
 * to `/issues/N`).
 */
export function remarkGithubReferences(options: GithubReferencesOptions = {}) {
    const repository = options.repository ?? null;

    return (tree: Root) => {
        findAndReplace(
            tree,
            [
                REFERENCE_RE,
                (value: string, owner: string | undefined, repo: string | undefined, number: string): Link | false => {
                    if (repo && DOT_SEGMENT_RE.test(repo)) {
                        return false;
                    }
                    const target = owner && repo ? `${owner}/${repo}` : repository;
                    if (!target) {
                        return false;
                    }
                    return {
                        type: "link",
                        url: `https://github.com/${target}/pull/${number}`,
                        children: [{ type: "text", value }],
                    };
                },
            ],
            { ignore: ["link", "linkReference", "definition"] },
        );
    };
}
