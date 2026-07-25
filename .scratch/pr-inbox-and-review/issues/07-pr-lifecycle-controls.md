# 07 — PR lifecycle controls

**What to build:** On the PR overview, the user can convert ready/draft, edit labels and assignees, add/remove reviewers and re-request review, and merge or close the PR — with confirmation on destructive actions. Can ship in parallel with the diff/review tickets once overview exists.

**Blocked by:** 04 — PR overview

**Status:** resolved

- [x] Ready for review / convert to draft works through the session and updates the overview
- [x] Labels and assignees can be edited
- [x] Reviewers can be added/removed and review re-requested
- [x] Merge and close require confirmation and then succeed via GitHub
- [x] Session tests cover mutations against the GitHub double and cache invalidation of affected views
