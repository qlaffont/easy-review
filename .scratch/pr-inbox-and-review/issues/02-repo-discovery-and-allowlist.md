# 02 — Repo discovery & allowlist

**What to build:** With a valid PAT, the user can discover repositories the token can access, toggle which ones feed the Inbox, and keep that allowlist across visits. A “N repos selected” style control makes the active set obvious. The Inbox itself is still empty or stubbed — this slice only makes repo selection real end-to-end through the session.

**Blocked by:** 01 — PAT + EasyReviewSession foundation

**Status:** resolved

- [x] Session discovers repos visible to the PAT
- [x] User can select/deselect repos; only the allowlist is treated as Inbox sources
- [x] Selected set persists in the browser across reload
- [x] UI shows how many repos are selected and lets the user change the set
- [x] Session tests cover discover + allowlist filtering with a GitHub double

## Comments

**Implementation notes**

- Session gains `loadRepositories` (cache-first), `refreshRepositories` (always hits GitHub), `setSelectedRepositories`, `toggleRepository` and `getSelectedRepositories`.
- The verified token now lives in a module-scoped variable inside the session, deliberately outside the reactive state so the UI can never render it. `requireToken()` is what makes "no token, no GitHub call" true.
- Discovery pages the GraphQL `viewer.repositories` connection 100 at a time, capped at 10 pages so a huge account cannot burn the rate limit in one refresh.
- A failed refresh keeps the cached list on screen and only records the error, which is what makes rate limiting survivable.
- Repository preferences are keyed to the authenticated login (`repos:account`). Code review caught that replacing a token through the header does not go through `disconnect()`, so without this the next account would inherit the previous one's allowlist and cache. Switching accounts therefore starts from an empty allowlist; rotating a token for the same account keeps it.
- `disconnect()` deletes the repo cache and the allowlist as well as the token: on a shared machine, a list of private repo names is itself a leak.
- UI: `RepoPickerProvider` owns one dialog shared by the header trigger ("N repos selected") and the Inbox empty state. Filtering uses `useDeferredValue` so typing stays responsive on large accounts.
