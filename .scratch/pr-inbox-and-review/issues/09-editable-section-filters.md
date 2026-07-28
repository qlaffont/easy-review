# 09 — Editable section filters (DNF)

**What to build:** Independent client-side DNF filters per Inbox section (named cases = OR, conditions = AND), custom sections, filter editor UI, assignees/labels on summaries. Replaces exclusive `classifyPullRequest`.

**Blocked by:** 08 — Inbox section customization

**Status:** resolved

- [x] Section membership is independent DNF over the shared selected-repo pool (overlap allowed; no catch-all)
- [x] Empty filter matches all; presets ship nearly-disjoint default filters; `classifyPullRequest` removed
- [x] Custom sections (recipes + duplicate); presets hide/reset only; Other is custom recipe not sacred
- [x] Filter editor with named cases, summary line, live match count + sample; entry from layout editor + section menu
- [x] `@me` + concrete logins; full + single-section export/import; assignees/labels on inbox summary
- [x] Session/unit tests cover default filters, grouping, settings v2 + v1 migrate

## Comments

Grilled 2026-07-28; implemented same day.
