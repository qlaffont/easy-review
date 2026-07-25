# 06 — Staged review + submit (+ thread replies)

**What to build:** While reviewing a diff, the user stages line comments locally, keeps them across reload, gets warned and invalidated when the PR head SHA moves, and submits one GitHub review (Comment / Approve / Request changes) that flushes pending comments. Existing review threads can be replied to in-product.

**Blocked by:** 05 — High-performance diff viewer

**Status:** resolved

- [x] User can add/remove pending line comments without hitting GitHub until submit
- [x] Drafts persist in the browser keyed by PR + head SHA and survive reload
- [x] Head SHA change warns and invalidates incompatible drafts
- [x] Submit sends one review with chosen event and clears pending comments on success
- [x] User can reply to existing review threads
- [x] Session tests cover draft lifecycle, invalidation, submit, and replies via doubles
