# 03 — Inbox triage board

**What to build:** The user opens an Inbox of PRs from the selected repos, grouped into Graphite-like sections with counts (Needs your review, Returned to you, Approved, Waiting for reviewers, Drafts, Merging and recently merged, Waiting for author, Other). Expanding a section shows dense rows (title, repo/number, author, reviewers, checks, diff stats, freshness). Last cache paints instantly; network revalidates on tab focus, manual refresh, or opening a section. Read-only — no PR detail page required beyond navigating stubs if needed.

**Blocked by:** 02 — Repo discovery & allowlist

**Status:** ready-for-agent

- [ ] Default Graphite-like sections render with counts (including zero)
- [ ] Expanding a section shows dense PR rows with the key triage signals
- [ ] Inbox queries only selected repos; prefer batched GraphQL where practical
- [ ] Cache-first paint; revalidate on focus, manual refresh, and section open — no background polling
- [ ] Session tests cover classification fixtures and cache vs revalidate behavior
