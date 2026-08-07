# 01 — OAuth + EasyReviewSession foundation

**What to build:** A reviewer can sign in with GitHub OAuth, see requested scopes explained in plain language, reconnect or sign out, and get clear errors for unauthorized/rate-limited sessions. All of this is owned by an `EasyReviewSession` port with swappable GitHub/persistence adapters for tests.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] User can sign in via GitHub OAuth; access token lives in an HTTP-only cookie (not browser JS storage)
- [x] Setup UI lists OAuth scopes for v1 read + mutation scope
- [x] `EasyReviewSession` is the sole port for auth state; GitHub/persistence are swappable adapters
- [x] Unauthorized and rate-limit failures surface understandable UI errors
- [x] Session-level tests cover auth required/cleared behavior with in-memory doubles (no DOM, no real GitHub)
- [x] Expired session on a returning browser auto-starts OAuth when prefs exist and user did not sign out
- [x] OAuth flow preserves return URL (relative path) and redirects there after successful callback
- [x] Explicit sign out sets `auth:signed-out` so auto-reconnect does not run on the next visit

## Comments

**Implementation notes**

- `src/lib/session/session.ts` is the port: `restore` / `connect` (tests/fixtures only) / `beginOAuthLogin` / `cancelConnect` / `disconnect` / `dismissError` over a `@tanstack/store` `Store<SessionState>`.
- Production auth: `/api/auth/github` + callback exchange; cookie via `auth-cookies.server.ts`; allowlisted proxy in `proxy.server.ts`.
- Adapters: `adapters/github-http-client.ts` (browser `fetch` against `/api/github`, maps HTTP + GraphQL failures to `EasyReviewError` kinds) and `adapters/browser-store.ts` (namespaced, versioned `localStorage` for non-secret prefs).
- Doubles: `testing/fake-github.ts` and `testing/memory-store.ts`. Reusing one memory store across two sessions is how "reload" is simulated.
- `restore()` probes the OAuth session credential (or settles unauthenticated without OAuth). Stays in `restoring` / `verifying` so a returning user never sees the connect screen flash.
- `tryAutoReconnectAfterExpiredSession()` — if `repos:account` exists and `auth:signed-out` is absent, calls `beginOAuthLogin()` instead of showing connect. Skipped when `?authError=` is present.
- `beginOAuthLogin()` passes `returnTo` (pathname + search + hash) to `/api/auth/github`; `oauth-return-to.server.ts` validates and stores an httpOnly cookie; callback redirects to it on success.
- `disconnect()` sets `auth:signed-out` in the browser store so auto-reconnect is disabled until the user signs in again manually.
- Only the newest credential check may write to state (`latestAuthAttempt` guard).
- Test tooling: Vitest (`vitest.config.ts`, node environment, `src/**/*.test.ts`) plus `test` / `test:watch` scripts.
