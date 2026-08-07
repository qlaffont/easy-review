# 03 — Inbox triage board

**What to build:** The user opens an Inbox of PRs from the selected repos, grouped into Graphite-like sections with counts (Needs your review, Returned to you, Waiting for reviewers (me), Approved, Drafts, Merging and recently merged, Waiting for author, Other). Expanding a section shows dense rows (title, repo/number, author, reviewers, checks, diff stats, freshness). Last cache paints instantly; network revalidates on tab focus, manual refresh, quiet interval while visible, optional background sync while hidden (when notifications enabled), or opening a section. Rows open GitHub by default; optional setting opens PRs in-app. Author re-requests move PRs from “Returned to you” to “Waiting for reviewers (me)” and show reviewers as pending again.

**Blocked by:** 02 — Repo discovery & allowlist

**Status:** resolved

- [x] Default Graphite-like sections render with counts (including zero)
- [x] Expanding a section shows dense PR rows with the key triage signals
- [x] Inbox queries only selected repos; prefer batched GraphQL where practical
- [x] Cache-first paint; revalidate on focus, manual refresh, section open, and throttled quiet interval while visible (~3 min)
- [x] Optional background inbox sync while tab hidden (~5 min) when desktop notifications are enabled
- [x] Inbox rows open GitHub in a new tab by default; optional “Open in Easy Review” preference for click, Enter, and command palette
- [x] Author changes-requested + re-request classification (`my-changes-requested` vs `my-waiting-for-reviewers`); reviewer chips respect `reviewRequests` via `displayReviewState`
- [x] Session tests cover classification fixtures and cache vs revalidate behavior

## Notes

Classification lives in `src/lib/session/section-filters.ts` and presets in
`inbox-sections.ts`. `displayReviewState()` in `reviewer-status.ts` shows pending when a
login is in `reviewRequests`. `getInboxSections()` filters to the allowlist at read time:
deselecting a repository hides its rows immediately instead of waiting for a refetch.

Inbox preferences (`src/lib/inbox-preferences.ts`): `openInEasyReview` (default false),
`backgroundNotifications` (default false). Background watcher:
`src/components/inbox/inbox-background-watcher.tsx`.

One aliased GraphQL document covers ten repositories, and a repository the token cannot read
comes back as a `null` alias rather than failing the batch. Only `RATE_LIMITED` and
`UNAUTHORIZED` condemn the whole response.

Product docs: `docs/inbox.md`, `CONTEXT.md` (Inbox + Refresh & notifications).

`VITE_FAKE_GITHUB=1 pnpm dev` serves the Inbox from fixtures (token `dev`) so the screens can
be looked at without handing a real token to a dev server. The seed is behind `import.meta.env.DEV`
and is absent from the production bundle.
