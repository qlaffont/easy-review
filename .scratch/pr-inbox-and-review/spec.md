Status: ready-for-agent

# Spec: PR Inbox and Review (v1)

## Problem Statement

As a former Graphite user, I want a fast, local-feeling GitHub pull-request triage and review tool without AI and without stacking. Graphite’s inbox and review flows are useful, but the product is heavy, AI-oriented, and struggles to render large or many-file diffs smoothly. I need the same workflow—multi-repo inbox, PR overview, and inline review—running as a hostable web app that talks to GitHub via a same-origin OAuth proxy, with no Easy Review database.

## Solution

Easy Review v1 is a TanStack Start web app that uses GitHub as the only backend. The user signs in with a **GitHub App** (user-to-server OAuth); the server holds the client secret and stores the user access token in an HTTP-only cookie, then proxies API calls. The browser discovers accessible repositories, persists an explicit selected-repo allowlist, and presents a Graphite-like inbox (configurable sections) plus PR overview and a high-performance diff review experience. Review comments are staged locally and submitted as one GitHub review; the app also supports full PR control (ready/draft, labels, assignees, merge, close, re-request). Data is cached in the browser for instant paint; the network is hit on tab focus, periodic quiet revalidate while visible, optional background sync while hidden, manual refresh, or when opening a section or PR. Inbox rows open GitHub by default; a setting opens PRs in-app instead. Expired sessions auto-reconnect to GitHub and return to the page the user was on. The UI follows Graphite’s information architecture and density, not Graphite’s visual brand.

## User Stories

1. As a reviewer, I want to sign in with GitHub OAuth, so that Easy Review can call the GitHub API without me pasting a secret into the browser.
2. As a reviewer, I want to reconnect or sign out, and when my session expires on a trusted browser I want to resume OAuth automatically and land back on the page I was viewing, so that I can rotate credentials or recover without losing context.
3. As a reviewer, I want the app to discover repositories my GitHub session can access, so that I do not have to type every `owner/repo` by hand.
4. As a reviewer, I want to select which discovered repos feed the Inbox, so that I only see work I care about.
5. As a reviewer, I want my selected-repo set persisted in the browser, so that I do not reconfigure on every visit.
6. As a reviewer, I want the Inbox to show Graphite-like sections by default (Needs your review, Returned to you, Approved, Waiting for reviewers, Drafts, Merging and recently merged, Waiting for author, Other), so that triage matches habits I already have.
7. As a reviewer, I want each section to show a count, so that I can see workload at a glance.
8. As a reviewer, I want to expand a section to see PR rows, so that I can scan titles, repos, authors, review progress, checks, diff stats, and freshness.
9. As a reviewer, I want to hide, reorder, or rename Inbox sections, so that the triage board matches my workflow over time.
10. As a reviewer, I want the last cached Inbox to paint immediately on open, so that the app feels faster than a cold Graphite load.
11. As a reviewer, I want the Inbox to revalidate when the tab gains focus and on a quiet interval while visible, so that I see reasonably fresh data without aggressive polling.
12. As a reviewer, I want a manual Refresh action, so that I can force a network sync when I know something changed.
13. As a reviewer, I want section rows to load when I expand a section (using cache when warm), so that idle sections do not waste API quota.
14. As a reviewer, I want inbox rows to open GitHub by default, with an optional setting to open PRs in Easy Review, so that triage can stay in the browser I already use for comments.
15. As a reviewer, I want optional desktop notifications when expanded inbox sections change while the tab is in the background, so that I can step away without missing updates on PRs I am watching.
16. As an author, after I re-request review on a changes-requested PR, I want it to leave “Returned to you” and show reviewers as pending again, so that inbox state matches GitHub.
17. As a reviewer, I want to open a PR from the Inbox into an overview page when using in-app navigation, so that I can read description, checks, reviewers, labels, and assignees without leaving Easy Review.
18. As an author, I want to mark a PR ready for review or convert it back to draft, so that I can manage reviewability from Easy Review.
19. As a reviewer, I want to add or remove reviewers and re-request review, so that I can drive the review loop from the overview.
20. As a maintainer, I want to edit labels and assignees on a PR, so that I can organize work without opening github.com.
21. As a maintainer, I want to merge or close a PR from Easy Review, so that I can finish the lifecycle in one place.
22. As a reviewer, I want to open a Review Changes view with a file list, so that I can navigate the change set.
23. As a reviewer, I want a file’s diff fetched and rendered only when I focus or open that file, so that large PRs do not download everything up front.
24. As a reviewer, I want diff lines virtualized, so that scrolling a large file does not freeze the tab.
25. As a reviewer, I want huge, binary, or generated files collapsed or stubbed by default with an opt-in to load, so that noise does not dominate the review.
26. As a reviewer, I want to leave pending line comments locally while reviewing, so that I can build a review before publishing.
27. As a reviewer, I want pending comments to survive page reload (stored in the browser), so that an accidental refresh does not wipe work.
28. As a reviewer, I want a warning and draft invalidation when the PR head SHA changes, so that I do not submit comments against stale lines.
29. As a reviewer, I want to submit one review with event Comment, Approve, or Request changes, flushing all pending comments, so that GitHub receives a single coherent review.
30. As a reviewer, I want to reply to existing review threads, so that conversation continues in-product.
31. As a reviewer, I want keyboard basics (e.g. move selection, open PR, search/command palette) in v1, so that triage is fast without a full shortcut engine.
32. As a power user, I want a command palette that lists available actions, so that I can discover and run operations without memorizing chords yet.
33. As a future power user, I want room for chorded shortcuts later (copy link, copy branch, etc.), so that the action model can grow without redesign.
34. As a reviewer, I want copy actions for PR URL, title, and branch name (via palette or menus), so that I can paste context into chat or terminal without “open in editor.”
35. As a reviewer, I want the app’s visual design to be Easy Review’s own system (shadcn/tokens), so that it feels like a product—not a Graphite skin—while keeping Graphite-like density and IA.
36. As a hostable-app user, I want to open a deployed Easy Review origin, sign in with GitHub, and only ever see my GitHub data for that OAuth session, so that isolation does not require a multi-tenant database.
37. As a security-conscious user, I want my access token to stay in an HTTP-only cookie on the Easy Review origin (never in `localStorage` or client JS), so that XSS cannot read it directly.
38. As a GitHub-only user, I want all forge behavior expressed in GitHub terms (pull requests, checks, reviews), so that the product stays simple with no GitLab abstraction.
39. As a user who may want stacking or AI later, I want v1 to omit those features entirely, so that the core inbox and review path ships without that complexity.
40. As a user who will never want web push, email alerts, mobile apps, local editor bridges, or team/multi-account features, I want those omitted from product direction, so that scope stays personal and web-only.
41. As a reviewer on many repos, I want Inbox queries batched via GitHub GraphQL where practical, so that multi-repo triage does not die on per-repo REST waterfalls.
42. As a reviewer, I want CI/check status visible on Inbox rows and on the PR overview, so that I know whether a PR is green before investing review time.
43. As a reviewer, I want author, reviewers, and engagement signals (e.g. commented/resolved style progress when available) on Inbox rows, so that I can prioritize without opening every PR.
44. As an author, I want my drafts and “waiting for reviewers” PRs visible in the right sections, so that I can track my own outbound work alongside inbound review.
45. As a reviewer, I want empty sections to still be visible with count zero, so that the board structure stays stable.
46. As a reviewer, I want errors from GitHub (expired session, rate limit, missing scope) explained in the UI, so that I know how to fix access problems.
47. As a reviewer, I want rate-limit pressure reduced by cache-first behavior and throttled background sync (not realtime polling), so that a hosted tab left open does not burn my quota.
48. As a developer of Easy Review, I want all product behavior reachable through one `EasyReviewSession` port, so that the UI stays thin and behavior can be tested without the DOM or real GitHub.

## Implementation Decisions

- **App shell**: Keep TanStack Start for routing/DX. OAuth callback, logout, and a tightly allowlisted GitHub API proxy live as server routes; product logic stays in the client session port.
- **Primary module / test seam**: `EasyReviewSession` is the single application port the UI uses. It coordinates auth preferences, repo selection, inbox, PR overview, diffs, drafts, mutations, and cache/revalidate policy. GitHub HTTP (via the same-origin proxy) and IndexedDB/`localStorage` (or equivalent browser persistence for non-secret prefs) are adapters behind this port.
- **Auth**: GitHub App OAuth. Server stores the user access token in HTTP-only cookies and attaches it when proxying. Expired sessions on a returning browser auto-start OAuth (unless the user signed out). Return URL is stored in an httpOnly cookie for post-login redirect. No personal access tokens, no device flow, no `gh` bridge.
- **Forge scope**: GitHub only. No forge abstraction layer for GitLab or others.
- **Repo selection**: Discover repos visible to the OAuth session; Inbox queries only the user-selected allowlist; persist allowlist locally.
- **Inbox model**: Default section taxonomy mirrors Graphite’s buckets; classification rules should match that mental model as closely as practical from GitHub PR state (review requests, draft, merge state, authorship, etc.). Author “changes requested” splits **Returned to you** vs **Waiting for reviewers (me)** when re-requests are outstanding. Reviewer chips show **pending** when a login is in `reviewRequests`, even if their last submitted review was approve/changes/comment. Section customization (hide/reorder/rename/filters) ships in Inbox settings.
- **Inbox navigation**: Rows open GitHub in a new tab by default (`openInEasyReview: false`). Optional setting opens `/pr/...` in-app; applies to click, Enter, and command palette.
- **Data fetching**: Prefer GitHub GraphQL for batched inbox-shaped reads; use REST where GraphQL is insufficient. TanStack Query plus browser persistence for stale-while-revalidate.
- **Refresh policy**: Paint from cache first. Revalidate on document focus, manual refresh, opening a section or PR, and after review/merge invalidation. While the tab is visible, quiet revalidate about every 3 minutes (throttled). While hidden, optional background inbox sync about every 5 minutes when desktop notifications are enabled. No websockets or web push.
- **Desktop notifications**: Opt-in via Inbox settings; browser `Notification` API only; scoped to expanded sections; only when the tab is in the background.
- **PR overview**: Title, body (markdown), author, branches, file/diff summary, checks, reviewers, labels, assignees, and primary actions.
- **Mutations (full PR control)**: Ready/draft toggle, labels, assignees, request/re-request reviewers, merge, close, and submit review (comment / approve / request changes). Confirm destructive actions (merge/close) in the UI.
- **Draft reviews**: Pending line comments and chosen review event live in browser storage keyed by `owner/repo` + PR number + head SHA. On head change, warn and invalidate incompatible drafts. Submit flushes as one GitHub review.
- **Diff performance**: Lazy per-file diff load; virtualized line rendering; default stubs/caps for huge, binary, and likely-generated files with explicit “load anyway.”
- **Keyboard**: v1 ships navigation basics + command palette wired to session actions. Chord sequences (e.g. copy shortcuts) are deferred until the action set is stable; design actions so chords can attach later.
- **Local disk**: No “open in editor,” no local path map, no companion process. Optional copy of URL/title/branch/`gh pr checkout`-style command text is fine via palette/menus.
- **Hosting model**: App is publicly hostable. Isolation is per-browser OAuth cookie + local cache—not a multi-tenant app database. Document the XSS / cookie / proxy threat model for operators.
- **UI**: Graphite-like IA and density; Easy Review visual system via existing shadcn/Tailwind stack—not a pixel clone of Graphite.
- **Stacking / AI**: Omitted from v1; may return in later specs. Do not leave half-built stacking UI.
- **Dependencies to add as needed**: GitHub API client suitable for browser GraphQL/REST via the proxy, markdown rendering, diff parsing/display helpers, virtualization library—chosen at implementation time behind the session adapters.

## Testing Decisions

- Good tests assert **external behavior** of `EasyReviewSession` (and pure helpers it owns), not React components, IndexedDB driver internals, or GitHub SDK call shapes.
- Replace GitHub and persistence with in-memory doubles in tests.
- Cover at least: authenticated operations require a session; repo discover + selected allowlist filtering; inbox section classification for representative PR fixtures (including author re-request and `displayReviewState`); cache-first inbox paint vs revalidate triggers; OAuth auto-reconnect vs sign-out and return URL sanitization; draft comment lifecycle (persist, survive “reload” of session storage double, invalidate on new head SHA, submit clears pending and records review on the GitHub double); lazy diff access does not require loading all files; mutation methods update the GitHub double and invalidate relevant cached views; error surfaces for unauthorized and rate-limited responses.
- Prefer one seam: do not add parallel test pyramids for UI unless a thin component test is later justified.
- Prior art: none in this repo yet (greenfield). Establish the session-level test style as the template for later features.

## Out of Scope

- AI / agents / automated review
- Stacked PRs / Graphite-style stacking
- GitLab or any second forge
- Notifications (web push, email, mobile push)
- Native mobile apps
- Local editor integration, filesystem path mapping, or companion git bridge
- Team features, shared workspaces, or multi-account switching productization (each visitor signs in with their own GitHub account)
- Realtime websockets or always-on polling regardless of tab visibility
- Cross-device draft sync
- Pixel-perfect Graphite visual clone
- Personal access tokens (fine-grained or classic) as a supported auth mode

## Further Notes

- This spec captures decisions from a grilling session; the user confirmed the `EasyReviewSession` test seam before publication. Auth later moved from browser-stored credentials to OAuth + HTTP-only cookie + allowlisted proxy.
- Domain terms and inbox/auth behavior are summarized in `CONTEXT.md`; product guides in `docs/inbox.md` and `docs/auth.md`.
- “Faster than Graphite” is a product claim with two halves: (1) warm local cache + fewer GraphQL round-trips, (2) not mounting giant diffs. Both are requirements, not stretch goals.
- Section classification will have edge cases versus Graphite; prefer predictable GitHub-derived rules documented near the classifier over reverse-engineering every Graphite quirk.
- OAuth scopes must be sufficient for read + the mutation set above; the connect UI should list requested scopes in plain language.
