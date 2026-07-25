Status: ready-for-agent

# Spec: PR Inbox and Review (v1)

## Problem Statement

As a former Graphite user, I want a fast, local-feeling GitHub pull-request triage and review tool without AI and without stacking. Graphite’s inbox and review flows are useful, but the product is heavy, AI-oriented, and struggles to render large or many-file diffs smoothly. I need the same workflow—multi-repo inbox, PR overview, and inline review—running as a hostable web app that talks to GitHub directly from the browser, with no Easy Review backend or database.

## Solution

Easy Review v1 is a TanStack Start web app that uses GitHub as the only backend. The user pastes a fine-grained personal access token; the browser discovers accessible repositories, persists an explicit selected-repo allowlist, and presents a Graphite-like inbox (configurable sections) plus PR overview and a high-performance diff review experience. Review comments are staged locally and submitted as one GitHub review; the app also supports full PR control (ready/draft, labels, assignees, merge, close, re-request). Data is cached in the browser for instant paint; the network is hit on tab focus, manual refresh, or when opening a section or PR. The UI follows Graphite’s information architecture and density, not Graphite’s visual brand.

## User Stories

1. As a reviewer, I want to paste a fine-grained GitHub PAT into the app, so that I can use Easy Review without signing through a server I operate.
2. As a reviewer, I want to clear or replace my stored PAT, so that I can rotate credentials or stop using the app on a shared machine.
3. As a reviewer, I want the app to discover repositories my PAT can access, so that I do not have to type every `owner/repo` by hand.
4. As a reviewer, I want to select which discovered repos feed the Inbox, so that I only see work I care about.
5. As a reviewer, I want my selected-repo set persisted in the browser, so that I do not reconfigure on every visit.
6. As a reviewer, I want the Inbox to show Graphite-like sections by default (Needs your review, Returned to you, Approved, Waiting for reviewers, Drafts, Merging and recently merged, Waiting for author, Other), so that triage matches habits I already have.
7. As a reviewer, I want each section to show a count, so that I can see workload at a glance.
8. As a reviewer, I want to expand a section to see PR rows, so that I can scan titles, repos, authors, review progress, checks, diff stats, and freshness.
9. As a reviewer, I want to hide, reorder, or rename Inbox sections, so that the triage board matches my workflow over time.
10. As a reviewer, I want the last cached Inbox to paint immediately on open, so that the app feels faster than a cold Graphite load.
11. As a reviewer, I want the Inbox to revalidate when the tab gains focus, so that I see reasonably fresh data without background polling.
12. As a reviewer, I want a manual Refresh action, so that I can force a network sync when I know something changed.
13. As a reviewer, I want section rows to load when I expand a section (using cache when warm), so that idle sections do not waste API quota.
14. As a reviewer, I want to open a PR from the Inbox into an overview page, so that I can read description, checks, reviewers, labels, and assignees without leaving Easy Review.
15. As an author, I want to mark a PR ready for review or convert it back to draft, so that I can manage reviewability from Easy Review.
16. As a reviewer, I want to add or remove reviewers and re-request review, so that I can drive the review loop from the overview.
17. As a maintainer, I want to edit labels and assignees on a PR, so that I can organize work without opening github.com.
18. As a maintainer, I want to merge or close a PR from Easy Review, so that I can finish the lifecycle in one place.
19. As a reviewer, I want to open a Review Changes view with a file list, so that I can navigate the change set.
20. As a reviewer, I want a file’s diff fetched and rendered only when I focus or open that file, so that large PRs do not download everything up front.
21. As a reviewer, I want diff lines virtualized, so that scrolling a large file does not freeze the tab.
22. As a reviewer, I want huge, binary, or generated files collapsed or stubbed by default with an opt-in to load, so that noise does not dominate the review.
23. As a reviewer, I want to leave pending line comments locally while reviewing, so that I can build a review before publishing.
24. As a reviewer, I want pending comments to survive page reload (stored in the browser), so that an accidental refresh does not wipe work.
25. As a reviewer, I want a warning and draft invalidation when the PR head SHA changes, so that I do not submit comments against stale lines.
26. As a reviewer, I want to submit one review with event Comment, Approve, or Request changes, flushing all pending comments, so that GitHub receives a single coherent review.
27. As a reviewer, I want to reply to existing review threads, so that conversation continues in-product.
28. As a reviewer, I want keyboard basics (e.g. move selection, open PR, search/command palette) in v1, so that triage is fast without a full shortcut engine.
29. As a power user, I want a command palette that lists available actions, so that I can discover and run operations without memorizing chords yet.
30. As a future power user, I want room for chorded shortcuts later (copy link, copy branch, etc.), so that the action model can grow without redesign.
31. As a reviewer, I want copy actions for PR URL, title, and branch name (via palette or menus), so that I can paste context into chat or terminal without “open in editor.”
32. As a reviewer, I want the app’s visual design to be Easy Review’s own system (shadcn/tokens), so that it feels like a product—not a Graphite skin—while keeping Graphite-like density and IA.
33. As a hostable-app user, I want to open a deployed Easy Review origin, paste my own PAT, and only ever see my GitHub data in my browser, so that isolation does not require a multi-tenant backend.
34. As a security-conscious user, I want the app never to send my PAT to an Easy Review server, so that GitHub credentials stay on the client.
35. As a GitHub-only user, I want all forge behavior expressed in GitHub terms (pull requests, checks, reviews), so that the product stays simple with no GitLab abstraction.
36. As a user who may want stacking or AI later, I want v1 to omit those features entirely, so that the core inbox and review path ships without that complexity.
37. As a user who will never want notifications, mobile apps, local editor bridges, or team/multi-account features, I want those omitted permanently from this product direction, so that scope stays personal and web-only.
38. As a reviewer on many repos, I want Inbox queries batched via GitHub GraphQL where practical, so that multi-repo triage does not die on per-repo REST waterfalls.
39. As a reviewer, I want CI/check status visible on Inbox rows and on the PR overview, so that I know whether a PR is green before investing review time.
40. As a reviewer, I want author, reviewers, and engagement signals (e.g. commented/resolved style progress when available) on Inbox rows, so that I can prioritize without opening every PR.
41. As an author, I want my drafts and “waiting for reviewers” PRs visible in the right sections, so that I can track my own outbound work alongside inbound review.
42. As a reviewer, I want empty sections to still be visible with count zero, so that the board structure stays stable.
43. As a reviewer, I want errors from GitHub (bad PAT, rate limit, missing scope) explained in the UI, so that I know how to fix access problems.
44. As a reviewer, I want rate-limit pressure reduced by cache-first behavior and no background polling, so that a hosted tab left open does not burn my quota.
45. As a developer of Easy Review, I want all product behavior reachable through one `EasyReviewSession` port, so that the UI stays thin and behavior can be tested without the DOM or real GitHub.

## Implementation Decisions

- **App shell**: Keep TanStack Start for routing/DX. Do not implement GitHub access, PAT storage, or business logic in server functions. Client-side modules own forge I/O.
- **Primary module / test seam**: `EasyReviewSession` is the single application port the UI uses. It coordinates auth preferences, repo selection, inbox, PR overview, diffs, drafts, mutations, and cache/revalidate policy. GitHub HTTP and IndexedDB (or equivalent browser persistence) are adapters behind this port.
- **Auth**: User-supplied fine-grained PAT stored only in the browser. No OAuth app, no device flow, no `gh` bridge in v1.
- **Forge scope**: GitHub only. No forge abstraction layer for GitLab or others.
- **Repo selection**: Discover repos visible to the PAT; Inbox queries only the user-selected allowlist; persist allowlist locally.
- **Inbox model**: Default section taxonomy mirrors Graphite’s buckets; classification rules should match that mental model as closely as practical from GitHub PR state (review requests, draft, merge state, authorship, etc.). Section customization (hide/reorder/rename) is in scope; defaults must ship first even if customization UI is thin.
- **Data fetching**: Prefer GitHub GraphQL for batched inbox-shaped reads; use REST where GraphQL is insufficient. TanStack Query (or equivalent) plus IndexedDB persistence for stale-while-revalidate.
- **Refresh policy**: Paint from cache first. Network revalidate on document focus, explicit refresh, and when opening a section or PR. No interval polling in v1. No push/notifications.
- **PR overview**: Title, body (markdown), author, branches, file/diff summary, checks, reviewers, labels, assignees, and primary actions.
- **Mutations (full PR control)**: Ready/draft toggle, labels, assignees, request/re-request reviewers, merge, close, and submit review (comment / approve / request changes). Confirm destructive actions (merge/close) in the UI.
- **Draft reviews**: Pending line comments and chosen review event live in browser storage keyed by `owner/repo` + PR number + head SHA. On head change, warn and invalidate incompatible drafts. Submit flushes as one GitHub review.
- **Diff performance**: Lazy per-file diff load; virtualized line rendering; default stubs/caps for huge, binary, and likely-generated files with explicit “load anyway.”
- **Keyboard**: v1 ships navigation basics + command palette wired to session actions. Chord sequences (e.g. copy shortcuts) are deferred until the action set is stable; design actions so chords can attach later.
- **Local disk**: No “open in editor,” no local path map, no companion process. Optional copy of URL/title/branch/`gh pr checkout`-style command text is fine via palette/menus.
- **Hosting model**: App is publicly hostable. Isolation is per-browser storage of PAT and cache—not server-side multi-tenancy. Document the XSS/token threat model for operators.
- **UI**: Graphite-like IA and density; Easy Review visual system via existing shadcn/Tailwind stack—not a pixel clone of Graphite.
- **Stacking / AI**: Omitted from v1; may return in later specs. Do not leave half-built stacking UI.
- **Dependencies to add as needed**: GitHub API client suitable for browser GraphQL/REST, markdown rendering, diff parsing/display helpers, virtualization library—chosen at implementation time behind the session adapters.

## Testing Decisions

- Good tests assert **external behavior** of `EasyReviewSession` (and pure helpers it owns), not React components, IndexedDB driver internals, or GitHub SDK call shapes.
- Replace GitHub and persistence with in-memory doubles in tests.
- Cover at least: PAT required for authenticated operations; repo discover + selected allowlist filtering; inbox section classification for representative PR fixtures; cache-first inbox paint vs revalidate triggers; draft comment lifecycle (persist, survive “reload” of session storage double, invalidate on new head SHA, submit clears pending and records review on the GitHub double); lazy diff access does not require loading all files; mutation methods update the GitHub double and invalidate relevant cached views; error surfaces for unauthorized and rate-limited responses.
- Prefer one seam: do not add parallel test pyramids for UI unless a thin component test is later justified.
- Prior art: none in this repo yet (greenfield). Establish the session-level test style as the template for later features.

## Out of Scope

- AI / agents / automated review
- Stacked PRs / Graphite-style stacking
- GitLab or any second forge
- Notifications (web push, email, desktop)
- Native mobile apps
- Local editor integration, filesystem path mapping, or companion git bridge
- Team features, shared workspaces, or multi-account switching productization (each visitor simply pastes their own PAT)
- Background interval polling or realtime websockets
- Cross-device draft sync
- Pixel-perfect Graphite visual clone
- Server-side proxying of GitHub or server-side storage of PATs

## Further Notes

- This spec captures decisions from a grilling session; the user confirmed the `EasyReviewSession` test seam before publication.
- There is no project `CONTEXT.md` or ADR set yet; if domain terms harden during implementation, record them in `CONTEXT.md` / `docs/adr/` rather than silently renaming the session port.
- “Faster than Graphite” is a product claim with two halves: (1) warm local cache + fewer GraphQL round-trips, (2) not mounting giant diffs. Both are requirements, not stretch goals.
- Section classification will have edge cases versus Graphite; prefer predictable GitHub-derived rules documented near the classifier over reverse-engineering every Graphite quirk.
- Fine-grained PAT scopes must be sufficient for read + the mutation set above; the setup UI should list required permissions in plain language.
