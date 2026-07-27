/**
 * Classic OAuth App scopes Easy Review requests at authorize time.
 * Keep this list in sync with every GraphQL field and REST route in the GitHub client.
 */
export const GITHUB_OAUTH_SCOPE_DEFS = [
    {
        name: "repo",
        why: "Private repositories, pull requests, diffs, reviews, merge/close, reactions, and git writes for applying suggestions.",
    },
    {
        name: "read:user",
        why: "Identify the signed-in GitHub account (login, name, avatar).",
    },
    {
        name: "read:org",
        why: "Read team names when a pull request requests review from an org team (Inbox + timeline).",
    },
] as const;

/** Space-separated scope string for the GitHub authorize URL. */
export const GITHUB_OAUTH_SCOPES = GITHUB_OAUTH_SCOPE_DEFS.map((scope) => scope.name).join(" ");
