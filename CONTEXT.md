# Easy Review — domain context

Single-context glossary for product behavior. ADRs live under `docs/adr/` when we record explicit decisions.

## Auth

| Term | Meaning |
| --- | --- |
| **OAuth session** | GitHub user access token stored in HTTP-only cookies on the Easy Review origin; proxied on `/api/github`. |
| **Reconnect** | Starting OAuth again when a previous account’s cookie expired. Returning users with saved prefs (`repos:account`) skip the connect screen and go straight to GitHub. |
| **Sign out** | Explicit `disconnect()` — clears the session and sets `auth:signed-out` so the next visit shows the connect screen instead of auto-reconnect. |
| **Return URL** | Relative path saved in an httpOnly cookie before OAuth; after a successful callback the browser lands back on that page (e.g. a PR you were reviewing). |

## Inbox

| Term | Meaning |
| --- | --- |
| **Section** | A filtered bucket of pull requests (preset or custom). Same PR may appear in multiple sections. |
| **Expanded section** | Section the user opened on the board; drives keyboard selection. |
| **Needs your review** | Open, non-draft PR where the viewer is in `reviewRequests`, including after a re-request while a prior approve/changes-requested review still exists. |
| **Returned to you** | Author’s PR with `reviewDecision: changes-requested` where at least one reviewer who requested changes has not been re-requested; other pending requests don’t count. Also an unapproved PR with a non-bot comment review whose reviewer has not been re-requested (`involvement: my-changes-requested`). |
| **Waiting for reviewers (me)** | Author’s open PR awaiting review with no active approval, including after a re-request when no reviewer has approved (`involvement: my-waiting-for-reviewers`). |
| **Display review state** | UI state for a reviewer row: if their login is in `reviewRequests`, show **pending** even when an older submitted review exists. |
| **Open in Easy Review** | Inbox preference (`openInEasyReview`): when off (default), row click opens GitHub in a new tab; when on, opens `/pr/...` in-app. |

## Refresh & notifications

| Term | Meaning |
| --- | --- |
| **Quiet revalidate** | Background inbox refetch while the tab is **visible**, throttled (~3 minutes). |
| **Background sync** | Inbox refetch every ~5 minutes while the tab is **hidden or not focused**, only when desktop notifications are enabled. |
| **Desktop notification** | Browser `Notification` (opt-in in Inbox settings); fires when a PR appears in a section with **Notify** on while the tab is hidden or not focused. Not web push. |

## Merge

| Term | Meaning |
| --- | --- |
| **Queued auto-merge** | An Easy Review intent to merge a pull request with a chosen method once GitHub reports it ready. Stored in the browser; Easy Review performs the merge. Independent of GitHub’s repository **Allow auto-merge** setting. |
| **Ready to auto-merge** | Open, not draft, no conflicts, reviews and required checks satisfied (`mergeStateStatus` is `clean` or `has_hooks`). |
| **Update branch** | GitHub “Update branch”: merge the base into the PR head when the PR is `behind`. Auto-merge does this when `viewerCanUpdateBranch` is true, then waits until the PR is ready. |

## Actions on GitHub

| Term | Meaning |
| --- | --- |
| **Optimistic action** | Review, comment, reply, edit, reaction or thread resolution: the UI shows it as done on click and sends it to GitHub behind the scenes, in click order per pull request. Merging and closing are not optimistic: they wait for GitHub. |
| **Refused action** | An optimistic action GitHub did not accept. Its effect is undone (a refused review restores the draft) and an alert stays until dismissed, with **Retry** and, when the action carries text, **Copy text**. |

## Files changed

| Term | Meaning |
| --- | --- |
| **Split view** | Diff preference for the split layout (`splitView`): **Both** versions side by side, or only the **Old** / **New** version at full width. A one-sided view hides lines that exist only on the other side, plus their comments and find-in-file hits; comments on context lines stay visible because those lines exist in both versions. |
| **Minimize comments** | Diff preference (`minimizeComments`) that shows each comment as its one-line header, opened with a click. Comments are never hidden. |
| **Hide test files** | Diff preference (`hideTestFiles`) that leaves test files out of the file list, viewed progress and next-file navigation. A test file is named like `foo.test.ts`, `foo_test.go` or `FooTest.kt`, or sits under a `test`, `tests` or `__tests__` folder. A link to a hidden file still opens its diff; the PR's file count and line totals stay whole. |
