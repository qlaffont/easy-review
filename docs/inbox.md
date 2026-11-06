# Inbox

Graphite-like triage board over the selected repository allowlist.

## Sections

Default presets include **Needs your review**, **Returned to you**, **Waiting for reviewers (me)**, **Approved**, **Drafts**, and others. Classification is GitHub-derived (`src/lib/session/section-filters.ts`); filters are editable per section in **Inbox settings**.

Notable flows:

- **Needs your review** — an open, non-draft PR currently requested of you, including when the author re-requested you after you already approved or requested changes.
- **Returned to you** — your open PR has changes requested and at least one reviewer who requested them has not been re-requested (other pending reviewers don’t count). Also when a human reviewer left a comment review, the PR has no approval, and that reviewer has not been re-requested (bot reviews and your own replies don’t count).
- **Waiting for reviewers (me)** — your open PR has no active approval and is awaiting review, including after you re-request validation from a reviewer who requested changes.
- **Approved** — your open PR has at least one active approval, even while other reviewers are still requested.
- **Waiting for author** — you already reviewed someone else’s PR and there is no outstanding request of you.

## Opening a pull request

**Default:** clicking a row opens the pull request on **GitHub** in a new tab.

**In-app review:** **Inbox settings → Navigation → Open pull requests in Easy Review**. Also applies to **Enter** and the command palette action “Open selected pull request”.

**Open all in new tabs:** the external-link button in a section header opens every pull request of that section in its own tab, following the same GitHub / Easy Review setting. Rows not loaded yet are fetched first, and sections with more than 20 pull requests ask for confirmation. Browsers allow only one tab per click by default: allow pop-ups for the site to open them all (a toast says when tabs were blocked).

**Close tab after review:** with this PR setting on, submitting a review closes the Easy Review tab if the pull request is the only page in its history. The tab waits for the submission to succeed, so a failure stays visible. A tab with other history entries stays open and follows the usual settings. Opening the next pull request in a stack takes priority over closing.

## Refresh behavior

| Trigger | Behavior |
| --- | --- |
| First paint | Cached inbox data from the browser when available |
| Tab focus / window focus | Background revalidate (respects minimum interval) |
| Tab visible, idle | Quiet revalidate about every 3 minutes |
| Manual **Refresh** | Full inbox refetch |
| After review / merge | Inbox marked stale and reloaded when returning to the board |
| Tab hidden or not focused + notifications on | Refetch about every 5 minutes |

## Background notifications (optional)

**Inbox settings → Background updates → Notify when a pull request appears**

- Requires browser notification permission.
- Only while the tab is hidden or not focused, and only while it is open: the browser must keep the page running (no web push).
- Notifies when a PR enters a section with **Notify** on (per section, expanded or not). Changes to a PR already in the section don't notify.
- **Notify** is on by default for Needs your review, Returned to you, and Approved.
- Sections load one page at a time. In a section with more rows than loaded, a new row only counts when the section total grew, so an old PR moving up doesn't notify.
- More than three new PRs in one sync → one summary notification.
- Easy Review plays its own four-note chime on top of whatever sound the OS or browser adds, so you can tell it apart from other apps. It plays once per PR across open tabs, and only from a tab you have clicked or typed in since it loaded: browsers block sound before that.

The main switch is stored in `localStorage` (`easy-review:inbox-prefs:v1`). **Notify** is part of the section layout, so it is included in Export / Import and restored by Reset.

## Keyboard

On the inbox: **↑/↓** move selection, **Enter** open (GitHub or Easy Review per setting), **⌘K** command palette.
