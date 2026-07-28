/**
 * Permissions a GitHub App must grant (user-to-server tokens ignore classic OAuth `scope=`).
 * Configure under the app → Permissions & events, then install / re-authorize.
 */
export const GITHUB_APP_PERMISSION_DEFS = [
    {
        name: "Contents",
        access: "Read and write",
        why: "Read files/diffs, apply suggestions, and upload comment media via the Git Data API.",
    },
    {
        name: "Pull requests",
        access: "Read and write",
        why: "Inbox, overview, reviews, merge/close, review requests.",
    },
    {
        name: "Issues",
        access: "Read and write",
        why: "Issue comments, labels, assignees, and reactions on PRs.",
    },
    {
        name: "Checks",
        access: "Read-only",
        why: "Check runs and Actions status on the PR overview.",
    },
    {
        name: "Commit statuses",
        access: "Read-only",
        why: "Legacy status contexts (CI bots) alongside Checks.",
    },
    {
        name: "Metadata",
        access: "Read-only",
        why: "Repository list and basic repo metadata (required by GitHub).",
    },
    {
        name: "Members",
        access: "Read-only",
        why: "Org team names on review requests (Inbox + timeline).",
    },
] as const;

/**
 * Optional classic `scope=` values still sent on the authorize URL.
 * GitHub App user tokens ignore these — permissions above are what matter.
 * Kept for compatibility if an OAuth App client is ever used in tests.
 */
export const GITHUB_OAUTH_SCOPE_DEFS = [
    {
        name: "repo",
        why: "Full repository access when using classic OAuth scopes (ignored for GitHub Apps).",
    },
    {
        name: "workflow",
        why: "Workflow file writes when using classic OAuth scopes (ignored for GitHub Apps).",
    },
    {
        name: "read:user",
        why: "Identify the signed-in user when using classic OAuth scopes.",
    },
    {
        name: "read:org",
        why: "Org/team reads when using classic OAuth scopes.",
    },
] as const;

/** Space-separated scope string for the GitHub authorize URL. */
export const GITHUB_OAUTH_SCOPES = GITHUB_OAUTH_SCOPE_DEFS.map((scope) => scope.name).join(" ");
