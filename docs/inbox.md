# Inbox

Graphite-like triage board over the selected repository allowlist.

## Sections

Default presets include **Needs your review**, **Returned to you**, **Waiting for reviewers (me)**, **Approved**, **Drafts**, and others. Classification is GitHub-derived (`src/lib/session/section-filters.ts`); filters are editable per section in **Inbox settings**.

Notable author flows:

- **Returned to you** — your open PR has changes requested and nobody is currently asked to re-review.
- **Waiting for reviewers (me)** — your PR still has changes requested, but you re-requested at least one reviewer (they show as pending in the sidebar and on inbox rows even if their last review was “request changes”).

## Opening a pull request

**Default:** clicking a row opens the pull request on **GitHub** in a new tab.

**In-app review:** **Inbox settings → Navigation → Open pull requests in Easy Review**. Also applies to **Enter** and the command palette action “Open selected pull request”.

## Refresh behavior

| Trigger | Behavior |
| --- | --- |
| First paint | Cached inbox data from the browser when available |
| Tab focus / window focus | Background revalidate (respects minimum interval) |
| Tab visible, idle | Quiet revalidate about every 3 minutes |
| Manual **Refresh** | Full inbox refetch |
| After review / merge | Inbox marked stale and reloaded when returning to the board |
| Tab in background + notifications on | Refetch about every 5 minutes |

## Background notifications (optional)

**Inbox settings → Background updates → Notify when open sections change**

- Requires browser notification permission.
- Only while the tab is in the background.
- Compares PRs in **expanded** sections; notifies on meaningful changes (reviews, checks, comments, new rows, etc.).
- More than three updates in one sync → one summary notification.

Stored in `localStorage` (`easy-review:inbox-prefs:v1`).

## Keyboard

On the inbox: **↑/↓** move selection, **Enter** open (GitHub or Easy Review per setting), **⌘K** command palette.
