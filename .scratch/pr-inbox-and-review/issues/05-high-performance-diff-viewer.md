# 05 — High-performance diff viewer

**What to build:** From the PR overview, the user enters Review Changes: a file list, per-file diffs loaded only when opened/focused, virtualized line rendering, and default stubs/caps for huge, binary, or likely-generated files with an explicit “load anyway.” No line comments yet — this slice proves large PRs stay usable.

**Blocked by:** 04 — PR overview

**Status:** ready-for-agent

- [ ] Review Changes shows the PR file list without rendering every file’s diff up front
- [ ] Opening/focusing a file fetches and renders that file’s diff lazily
- [ ] Diff lines are virtualized so large files remain scrollable without freezing
- [ ] Huge/binary/generated files are stubbed/capped by default with opt-in full load
- [ ] Session tests assert lazy diff access does not require loading all files
