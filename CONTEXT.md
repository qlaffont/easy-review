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
| **Expanded section** | Section the user opened on the board; drives keyboard selection and background-notification scope. |
| **Returned to you** | Author’s PR with `reviewDecision: changes-requested` and no outstanding re-review requests (`involvement: my-changes-requested`). |
| **Waiting for reviewers (me)** | Author’s PR still blocked on review but at least one reviewer is back in `reviewRequests` after a re-request (`involvement: my-waiting-for-reviewers`). |
| **Display review state** | UI state for a reviewer row: if their login is in `reviewRequests`, show **pending** even when an older submitted review exists. |
| **Open in Easy Review** | Inbox preference (`openInEasyReview`): when off (default), row click opens GitHub in a new tab; when on, opens `/pr/...` in-app. |

## Refresh & notifications

| Term | Meaning |
| --- | --- |
| **Quiet revalidate** | Background inbox refetch while the tab is **visible**, throttled (~3 minutes). |
| **Background sync** | Inbox refetch every ~5 minutes while the tab is **hidden**, only when desktop notifications are enabled. |
| **Desktop notification** | Browser `Notification` (opt-in in Inbox settings); fires when a PR in an **expanded** section changes while the tab is in the background. Not web push. |

## Merge

| Term | Meaning |
| --- | --- |
| **Queued auto-merge** | An Easy Review intent to merge a pull request with a chosen method once GitHub reports it ready. Stored in the browser; Easy Review performs the merge. Independent of GitHub’s repository **Allow auto-merge** setting. |
| **Ready to auto-merge** | Open, not draft, no conflicts, reviews and required checks satisfied (`mergeStateStatus` is `clean` or `has_hooks`). |
