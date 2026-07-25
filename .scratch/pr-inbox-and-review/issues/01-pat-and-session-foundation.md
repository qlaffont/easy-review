# 01 — PAT + EasyReviewSession foundation

**What to build:** A reviewer can paste a fine-grained GitHub PAT into Easy Review, see required scopes explained in plain language, clear or replace the token, and get clear errors for bad/unauthorized/rate-limited credentials. All of this is owned by an `EasyReviewSession` port with browser-only storage and in-memory doubles for tests — no Inbox yet, and no GitHub calls from the server.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] User can paste, persist, clear, and replace a PAT in the browser only
- [ ] Setup UI lists required fine-grained permissions for v1 read + mutation scope
- [ ] `EasyReviewSession` is the sole port for auth state; GitHub/persistence are swappable adapters
- [ ] Unauthorized and rate-limit failures surface understandable UI errors
- [ ] Session-level tests cover PAT required/cleared behavior with in-memory doubles (no DOM, no real GitHub)
