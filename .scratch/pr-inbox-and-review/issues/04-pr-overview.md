# 04 — PR overview

**What to build:** From an Inbox row, the user opens a PR overview: title, markdown body, author, branch mapping, file/diff summary, checks, reviewers, labels, and assignees — Easy Review visual system, Graphite-like density. Read-only for mutations; a clear path exists to start “Review Changes” (can be a stub route until ticket 05).

**Blocked by:** 03 — Inbox triage board

**Status:** ready-for-agent

- [ ] Clicking an Inbox row opens the PR overview for that `owner/repo#number`
- [ ] Overview shows description, checks, reviewers, labels, assignees, and branch/stats summary
- [ ] Opening a PR uses cache when warm and revalidates per the session refresh policy
- [ ] No server-side GitHub calls; session owns the load
- [ ] Session tests cover overview load and basic error cases for missing/inaccessible PRs
