# 03 — Inbox triage board

**What to build:** The user opens an Inbox of PRs from the selected repos, grouped into Graphite-like sections with counts (Needs your review, Returned to you, Approved, Waiting for reviewers, Drafts, Merging and recently merged, Waiting for author, Other). Expanding a section shows dense rows (title, repo/number, author, reviewers, checks, diff stats, freshness). Last cache paints instantly; network revalidates on tab focus, manual refresh, or opening a section. Read-only — no PR detail page required beyond navigating stubs if needed.

**Blocked by:** 02 — Repo discovery & allowlist

**Status:** resolved

- [x] Default Graphite-like sections render with counts (including zero)
- [x] Expanding a section shows dense PR rows with the key triage signals
- [x] Inbox queries only selected repos; prefer batched GraphQL where practical
- [x] Cache-first paint; revalidate on focus, manual refresh, and section open — no background polling
- [x] Session tests cover classification fixtures and cache vs revalidate behavior

## Notes

Classification lives in `src/lib/session/inbox-sections.ts`, apart from the session, so the
section rules can be read and tested without a store or a GitHub client. `getInboxSections()`
filters to the allowlist at read time: deselecting a repository hides its rows immediately
instead of waiting for a refetch.

One aliased GraphQL document covers ten repositories, and a repository the token cannot read
comes back as a `null` alias rather than failing the batch. Only `RATE_LIMITED` and
`UNAUTHORIZED` condemn the whole response.

`VITE_FAKE_GITHUB=1 bun run dev` serves the Inbox from fixtures (token `dev`) so the screens can
be looked at without handing a real token to a dev server. The seed is behind `import.meta.env.DEV`
and is absent from the production bundle.
