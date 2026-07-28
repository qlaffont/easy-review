# 01 — OAuth + EasyReviewSession foundation

**What to build:** A reviewer can sign in with GitHub OAuth, see requested scopes explained in plain language, reconnect or sign out, and get clear errors for unauthorized/rate-limited sessions. All of this is owned by an `EasyReviewSession` port with swappable GitHub/persistence adapters for tests.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] User can sign in via GitHub OAuth; access token lives in an HTTP-only cookie (not browser JS storage)
- [x] Setup UI lists OAuth scopes for v1 read + mutation scope
- [x] `EasyReviewSession` is the sole port for auth state; GitHub/persistence are swappable adapters
- [x] Unauthorized and rate-limit failures surface understandable UI errors
- [x] Session-level tests cover auth required/cleared behavior with in-memory doubles (no DOM, no real GitHub)

## Comments

**Implementation notes**

- `src/lib/session/session.ts` is the port: `restore` / `connect` (tests/fixtures only) / `beginOAuthLogin` / `cancelConnect` / `disconnect` / `dismissError` over a `@tanstack/store` `Store<SessionState>`.
- Production auth: `/api/auth/github` + callback exchange; cookie via `auth-cookies.server.ts`; allowlisted proxy in `proxy.server.ts`.
- Adapters: `adapters/github-http-client.ts` (browser `fetch` against `/api/github`, maps HTTP + GraphQL failures to `EasyReviewError` kinds) and `adapters/browser-store.ts` (namespaced, versioned `localStorage` for non-secret prefs).
- Doubles: `testing/fake-github.ts` and `testing/memory-store.ts`. Reusing one memory store across two sessions is how "reload" is simulated.
- `restore()` probes the OAuth session credential (or settles unauthenticated without OAuth). Stays in `restoring` so a returning user never sees the connect screen flash.
- Only the newest credential check may write to state (`latestAuthAttempt` guard).
- Test tooling: Vitest (`vitest.config.ts`, node environment, `src/**/*.test.ts`) plus `test` / `test:watch` scripts.
