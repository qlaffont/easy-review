# 09 — Command palette, keyboard basics & copy actions

**What to build:** Power-user triage without a chord engine: keyboard basics to move selection and open a PR, a command palette listing session actions (including review and lifecycle actions), and copy actions for PR URL, title, and branch name (checkout command text optional if cheap). Designed so chord shortcuts can attach later.

**Blocked by:** 06 — Staged review + submit (+ thread replies); 07 — PR lifecycle controls

**Status:** resolved

- [x] Keyboard basics support moving selection and opening the selected PR
- [x] Command palette lists and runs available session actions
- [x] User can copy PR URL, title, and branch name
- [x] No chord-sequence engine required; actions are named so chords can attach later
- [x] Behavior is wired through session/actions rather than one-off UI-only handlers where practical
