import type { Link, Root } from "mdast";

import { findAndReplace } from "mdast-util-find-and-replace";

/**
 * `owner/repo#123` or bare `#123`. The lookbehind keeps `abc#1`, `path/#1` and URL fragments
 * out, as GitHub does; `\b` after the digits rejects `#12abc`.
 */
const REFERENCE_RE = /(?<![\w./#-])(?:([a-zA-Z\d](?:[a-zA-Z\d-]{0,38}))\/([\w.-]{1,100}))?#(\d+)\b/g;

export type GithubReferencesOptions = {
    /** `owner/repo` that bare `#123` points at; bare references stay text without it. */
    repository?: string | null;
};

/**
 * Link issue / pull request references the way GitHub renders them. They point at `/issues/N`:
 * the markdown alone cannot tell an issue from a pull request, and GitHub redirects that path
 * to `/pull/N` when it is one.
 */
export function remarkGithubReferences(options: GithubReferencesOptions = {}) {
    const repository = options.repository ?? null;

    return (tree: Root) => {
        findAndReplace(
            tree,
            [
                REFERENCE_RE,
                (value: string, owner: string | undefined, repo: string | undefined, number: string): Link | false => {
                    const target = owner && repo ? `${owner}/${repo}` : repository;
                    if (!target) {
                        return false;
                    }
                    return {
                        type: "link",
                        url: `https://github.com/${target}/issues/${number}`,
                        children: [{ type: "text", value }],
                    };
                },
            ],
            { ignore: ["link", "linkReference", "definition"] },
        );
    };
}
