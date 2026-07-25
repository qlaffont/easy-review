# 04 — PR overview

**What to build:** From an Inbox row, the user opens a PR overview: title, markdown body, author, branch mapping, file/diff summary, checks, reviewers, labels, and assignees — Easy Review visual system, Graphite-like density. Read-only for mutations; a clear path exists to start “Review Changes” (can be a stub route until ticket 05).

**Blocked by:** 03 — Inbox triage board

**Status:** resolved

- [x] Clicking an Inbox row opens the PR overview for that `owner/repo#number`
- [x] Overview shows description, checks, reviewers, labels, assignees, and branch/stats summary
- [x] Opening a PR uses cache when warm and revalidates per the session refresh policy
- [x] No server-side GitHub calls; session owns the load
- [x] Session tests cover overview load and basic error cases for missing/inaccessible PRs

## Notes

Inbox rows are now `<Link>`s to `/pr/$owner/$repo/$number` rather than links out to github.com.

Overviews are held for the life of the tab and are not written to browser storage: they are large,
they go stale quickly, and the Inbox row — which *is* persisted — carries the title, author,
branches and stats needed to paint a header while GitHub answers. `getPullRequestPage()` returns
the detail and that row together, so a cold reload never shows an empty page.

The overview query reuses the Inbox fragment and adds body, labels, assignees, head SHA and the
individual check runs. Since both selections ask for `commits(last: 1)`, GraphQL merges them and
the extra fields cost no additional round trip.

Relative links in a description resolve against `github.com/owner/repo/blob/<base>/`, matching
where GitHub itself points them. Raw HTML in a body is dropped by `react-markdown`.

"Review changes" is present but disabled until ticket 05 builds the diff viewer.
