# 01 — PAT + EasyReviewSession foundation

**What to build:** A reviewer can paste a fine-grained GitHub PAT into Easy Review, see required scopes explained in plain language, clear or replace the token, and get clear errors for bad/unauthorized/rate-limited credentials. All of this is owned by an `EasyReviewSession` port with browser-only storage and in-memory doubles for tests — no Inbox yet, and no GitHub calls from the server.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] User can paste, persist, clear, and replace a PAT in the browser only
- [x] Setup UI lists required fine-grained permissions for v1 read + mutation scope
- [x] `EasyReviewSession` is the sole port for auth state; GitHub/persistence are swappable adapters
- [x] Unauthorized and rate-limit failures surface understandable UI errors
- [x] Session-level tests cover PAT required/cleared behavior with in-memory doubles (no DOM, no real GitHub)

## Comments

**Implementation notes**

- `src/lib/session/session.ts` is the port: `restore` / `connect` / `cancelConnect` / `disconnect` / `dismissError` over a `@tanstack/store` `Store<SessionState>`.
- Adapters: `adapters/github-http-client.ts` (browser `fetch` against the GraphQL API, maps HTTP + GraphQL failures to `EasyReviewError` kinds) and `adapters/browser-store.ts` (namespaced, versioned `localStorage`, every call guarded because storage throws in private browsing).
- Doubles: `testing/fake-github.ts` and `testing/memory-store.ts`. Reusing one memory store across two sessions is how "reload" is simulated.
- `restore()` stays in the `restoring` status while checking a stored token so a returning user never sees the connect screen flash.
- Only the newest credential check may write to state (`latestAuthAttempt` guard). This came out of code review: a superseded paste, a cancelled replacement, or a request landing after `disconnect()` could otherwise resurrect a session or clobber a newer one.
- Test tooling did not exist in this repo. Added Vitest (`vitest.config.ts`, node environment, `src/**/*.test.ts`) plus `test` / `test:watch` scripts.
- The starter's marketing CSS (hero gradients, `.island-*`, `.nav-link`, unused colour tokens, the Fraunces font) was deleted so the product surface starts from the shadcn tokens only.
