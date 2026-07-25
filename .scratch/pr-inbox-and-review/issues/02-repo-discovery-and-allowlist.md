# 02 — Repo discovery & allowlist

**What to build:** With a valid PAT, the user can discover repositories the token can access, toggle which ones feed the Inbox, and keep that allowlist across visits. A “N repos selected” style control makes the active set obvious. The Inbox itself is still empty or stubbed — this slice only makes repo selection real end-to-end through the session.

**Blocked by:** 01 — PAT + EasyReviewSession foundation

**Status:** ready-for-agent

- [ ] Session discovers repos visible to the PAT
- [ ] User can select/deselect repos; only the allowlist is treated as Inbox sources
- [ ] Selected set persists in the browser across reload
- [ ] UI shows how many repos are selected and lets the user change the set
- [ ] Session tests cover discover + allowlist filtering with a GitHub double
