# 07 — PR lifecycle controls

**What to build:** On the PR overview, the user can convert ready/draft, edit labels and assignees, add/remove reviewers and re-request review, and merge or close the PR — with confirmation on destructive actions. Can ship in parallel with the diff/review tickets once overview exists.

**Blocked by:** 04 — PR overview

**Status:** ready-for-agent

- [ ] Ready for review / convert to draft works through the session and updates the overview
- [ ] Labels and assignees can be edited
- [ ] Reviewers can be added/removed and review re-requested
- [ ] Merge and close require confirmation and then succeed via GitHub
- [ ] Session tests cover mutations against the GitHub double and cache invalidation of affected views
