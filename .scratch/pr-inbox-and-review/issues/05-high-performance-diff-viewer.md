# 05 — High-performance diff viewer

**What to build:** From the PR overview, the user enters Review Changes: a file list, per-file diffs loaded only when opened/focused, virtualized line rendering, and default stubs/caps for huge, binary, or likely-generated files with an explicit “load anyway.” No line comments yet — this slice proves large PRs stay usable.

**Blocked by:** 04 — PR overview

**Status:** resolved

- [x] Review Changes shows the PR file list without rendering every file’s diff up front
- [x] Opening/focusing a file fetches and renders that file’s diff lazily
- [x] Diff lines are virtualized so large files remain scrollable without freezing
- [x] Huge/binary/generated files are stubbed/capped by default with opt-in full load
- [x] Session tests assert lazy diff access does not require loading all files

## Notes

Route: `/pr/$owner/$repo/$number/files` (flat sibling via `number_.files`, so the overview
does not need an `<Outlet>`).

The file list is GraphQL metadata only. Opening a file fetches the base and head blobs over
REST and builds a unified diff in the browser — so reviewing `src/a.ts` never requests
`src/b.ts`. Generated paths and binary extensions stub before any blob is read; huge blobs
stub from `size` (or content) until “Load anyway”. Binary never expands.

Diff lines use `@tanstack/react-virtual`. Refreshing the file list clears cached diffs so a
stale head cannot keep painting.
