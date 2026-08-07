# Authentication

Easy Review uses a **GitHub App** (not an OAuth App). Setup: [github-setup.md](./github-setup.md).

## Sign in

1. User clicks **Sign in with GitHub** (or is sent there automatically — see below).
2. Browser hits `/api/auth/github`, which stores a **return URL** cookie and redirects to GitHub.
3. Callback `/api/auth/github/callback` exchanges the code, sets HTTP-only token cookies, and redirects to the return URL (default `/`).

Return URLs must be same-origin relative paths (no open redirects). Paths under `/api/` are rejected.

## Reconnect vs sign out

| Situation | Behavior |
| --- | --- |
| Cookie expired, same browser, previously signed in (`repos:account` present), not signed out | Auto-start OAuth; after login, land on the page you were on |
| Explicit **Sign out** | Connect screen on next visit; prefs kept for the same GitHub login on reconnect |
| First visit / no saved account | Connect screen; manual sign-in |

Auto-reconnect does not run when the URL contains `?authError=` (failed OAuth attempt).

## Session in the app

- Production: `EasyReviewSession.restore()` probes the cookie via the GitHub proxy.
- Tests / fixture mode: `VITE_FAKE_GITHUB=1` uses an in-memory token; no OAuth.
- Token never stored in `localStorage` or client-accessible storage.

## Security notes for operators

- Treat the OAuth proxy as a public API boundary: allowlisted routes only.
- XSS on the origin can still invoke the proxy with the user’s cookie — use CSP and dependency hygiene (`bun audit` / lockfile overrides).
- `GITHUB_SESSION_SECRET` encrypts refresh-token payload when using expiring user tokens.
