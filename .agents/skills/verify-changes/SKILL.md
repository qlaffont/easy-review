---
name: verify-changes
description: Verify every code change by running lint, typecheck, tests, and app-size budgets, then fix failures before considering the work done. Use after editing source, implementing, refactoring, or finishing a change. Use when the user mentions lint, types, tests, bundle size, app size, or CI.
---

# Verify changes

After every coherent edit (files written), run this gate. The change is not done until all four checks pass.

Do not start the next task, a commit, or a PR while any check is red.

IDE diagnostics are not a substitute.

## Gate (in order)

Commands live in `package.json`. If a script is renamed, use the script.

1. **Lint** — `pnpm lint`, then `pnpm lint:check` and `pnpm format:check`.
2. **Type** — `pnpm typecheck`.
3. **Tests** — `pnpm test`.
4. **App size** — `pnpm build`, then `pnpm check:size`.

Fix each failure before continuing. Re-run the failed check, then the rest of the gate. After a source fix, re-run from the failed step (full gate if unsure).

`pnpm test` and `pnpm typecheck` may run in parallel after lint is green. App size always follows a successful build.

## Fix

- **Lint** — apply auto-fixes from `pnpm lint`. Remaining oxlint/oxfmt issues: edit source until `lint:check` and `format:check` exit 0.
- **Type** — fix the TypeScript errors. Do not silence the gate with `as` casts or `@ts-expect-error`.
- **Tests** — make the behavior pass. Do not delete or skip tests to go green unless the user asked to remove that behavior.
- **App size** — shrink the client bundle (code-split, drop unused imports/deps). Do not raise budgets in `scripts/check-bundle-size.mjs` unless the user explicitly asks.

## Skip

Skip the gate only when the turn made no file changes.

Run **app size** whenever `src/`, `package.json`, lockfile, or bundler config changed. Skip app size only for docs/skills/markdown-only edits; still run lint, type, and tests if those files are typechecked or tested.

## Done when

All four checks exit 0. Report pass/fail for each in the wrap-up.
