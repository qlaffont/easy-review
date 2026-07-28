import type { PullRequestSummary } from "#/lib/session/types.ts";

export type InboxSectionId =
    | "needs-your-review"
    | "returned-to-you"
    | "approved"
    | "waiting-for-reviewers"
    | "drafts"
    | "merging-and-recently-merged"
    | "waiting-for-author"
    | "other";

export const SECTION_COLOR_IDS = ["amber", "rose", "emerald", "sky", "slate", "violet", "teal", "muted"] as const;

export type SectionColorId = (typeof SECTION_COLOR_IDS)[number];

export const SECTION_ICON_IDS = [
    "eye",
    "undo",
    "check",
    "users",
    "draft",
    "merge",
    "hourglass",
    "inbox",
    "alert",
    "star",
    "bookmark",
    "flame",
    "zap",
    "circle",
    "folder",
    "git-branch",
    "git-pull-request",
    "git-commit",
    "message",
    "messages",
    "clock",
    "timer",
    "thumbs-up",
    "thumbs-down",
    "flag",
    "pin",
    "heart",
    "sparkles",
    "search",
    "filter",
    "list",
    "layers",
    "archive",
    "package",
    "rocket",
    "target",
    "bell",
    "shield",
    "lock",
    "user",
    "user-check",
    "refresh",
    "send",
    "bug",
    "wrench",
    "file-code",
    "code",
    "coffee",
] as const;

export type SectionIconId = (typeof SECTION_ICON_IDS)[number];

export type InboxSectionDefinition = {
    id: InboxSectionId;
    label: string;
};

/** Graphite's buckets, in Graphite's order. Customising them is issue 08. */
export const DEFAULT_INBOX_SECTIONS: ReadonlyArray<InboxSectionDefinition> = [
    { id: "needs-your-review", label: "Needs your review" },
    { id: "returned-to-you", label: "Returned to you" },
    { id: "approved", label: "Approved" },
    { id: "waiting-for-reviewers", label: "Waiting for reviewers" },
    { id: "drafts", label: "Drafts" },
    { id: "merging-and-recently-merged", label: "Merging and recently merged" },
    { id: "waiting-for-author", label: "Waiting for author" },
    { id: "other", label: "Other" },
];

export const DEFAULT_SECTION_APPEARANCE: Record<InboxSectionId, { color: SectionColorId; icon: SectionIconId }> = {
    "needs-your-review": { color: "amber", icon: "eye" },
    "returned-to-you": { color: "rose", icon: "undo" },
    approved: { color: "emerald", icon: "check" },
    "waiting-for-reviewers": { color: "sky", icon: "users" },
    drafts: { color: "slate", icon: "draft" },
    "merging-and-recently-merged": { color: "violet", icon: "merge" },
    "waiting-for-author": { color: "teal", icon: "hourglass" },
    other: { color: "muted", icon: "inbox" },
};

/**
 * Rules are derived from GitHub state only, and are deliberately ordered and total: every pull
 * request lands in exactly one section. Graphite has quirks we do not reverse-engineer; when in
 * doubt a pull request falls through to `other` rather than guessing.
 *
 * 1. Merged pull requests are done with, whoever wrote them.
 * 2. Closed-without-merging is noise, so it goes to `other`.
 * 3. Your own pull requests are bucketed by what is blocking them: draft, changes requested,
 *    approved, or simply waiting on reviewers.
 * 4. On someone else's pull request, an outstanding review request means it is your turn — GitHub
 *    clears that request once you review and re-adds it when review is re-requested.
 * 5. If you already reviewed and no new request came back, the ball is in the author's court.
 */
export function classifyPullRequest(pullRequest: PullRequestSummary, viewerLogin: string): InboxSectionId {
    if (pullRequest.state === "merged") {
        return "merging-and-recently-merged";
    }

    if (pullRequest.state === "closed") {
        return "other";
    }

    if (pullRequest.author === viewerLogin) {
        if (pullRequest.isDraft) {
            return "drafts";
        }

        if (pullRequest.reviewDecision === "changes-requested") {
            return "returned-to-you";
        }

        if (pullRequest.reviewDecision === "approved") {
            return "approved";
        }

        return "waiting-for-reviewers";
    }

    if (pullRequest.isDraft) {
        return "other";
    }

    if (pullRequest.reviewRequests.includes(viewerLogin)) {
        return "needs-your-review";
    }

    const viewerReview = pullRequest.reviewers.find((reviewer) => reviewer.login === viewerLogin);

    if (viewerReview && viewerReview.state !== "pending") {
        return "waiting-for-author";
    }

    return "other";
}

export type InboxSection = InboxSectionDefinition & {
    pullRequests: Array<PullRequestSummary>;
};

/** One row of the user's Inbox layout: order in the array is display order. */
export type InboxSectionLayoutEntry = {
    id: InboxSectionId;
    /** Display label; empty or whitespace falls back to the Graphite default. */
    label: string;
    hidden: boolean;
    /** Whether the section starts expanded when there is no saved collapse state (or after reset). */
    defaultExpanded: boolean;
    color: SectionColorId;
    /** Custom accent as `#RRGGBB`; when set it overrides the preset `color` for rendering. */
    customColor: string | null;
    icon: SectionIconId;
};

export const INBOX_SETTINGS_VERSION = 1 as const;

/** Portable Inbox preferences: collapse state + section layout (visibility, labels, colors, icons). */
export type InboxSettings = {
    version: typeof INBOX_SETTINGS_VERSION;
    expandedSections: Array<InboxSectionId>;
    sectionLayout: Array<InboxSectionLayoutEntry>;
};

const SECTION_ID_SET = new Set<string>(DEFAULT_INBOX_SECTIONS.map((definition) => definition.id));
const COLOR_ID_SET = new Set<string>(SECTION_COLOR_IDS);
const ICON_ID_SET = new Set<string>(SECTION_ICON_IDS);

export function isSectionColorId(value: unknown): value is SectionColorId {
    return typeof value === "string" && COLOR_ID_SET.has(value);
}

export function isSectionIconId(value: unknown): value is SectionIconId {
    return typeof value === "string" && ICON_ID_SET.has(value);
}

export function isInboxSectionId(value: unknown): value is InboxSectionId {
    return typeof value === "string" && SECTION_ID_SET.has(value);
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalize `#abc` / `#AABBCC` to lowercase `#rrggbb`, or null when invalid. */
export function normalizeHexColor(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
        return null;
    }

    const hex = trimmed.slice(1);
    if (hex.length === 3) {
        return `#${hex
            .split("")
            .map((digit) => `${digit}${digit}`)
            .join("")
            .toLowerCase()}`;
    }

    return `#${hex.toLowerCase()}`;
}

export function isHexColor(value: unknown): value is string {
    return normalizeHexColor(value) !== null;
}

const DEFAULT_EXPANDED_SECTION_IDS = new Set<InboxSectionId>(["needs-your-review", "returned-to-you", "approved"]);

export function defaultSectionLayout(): Array<InboxSectionLayoutEntry> {
    return DEFAULT_INBOX_SECTIONS.map((definition) => {
        const appearance = DEFAULT_SECTION_APPEARANCE[definition.id];
        return {
            id: definition.id,
            label: definition.label,
            /** Waiting-on-reviewers is noise for most reviewers; add it back from Sections if needed. */
            hidden: definition.id === "waiting-for-reviewers",
            defaultExpanded: DEFAULT_EXPANDED_SECTION_IDS.has(definition.id),
            color: appearance.color,
            customColor: null,
            icon: appearance.icon,
        };
    });
}

/** Section ids that should start open, from layout preferences (ignores hidden sections). */
export function defaultExpandedSections(
    layout: ReadonlyArray<InboxSectionLayoutEntry> = defaultSectionLayout(),
): Array<InboxSectionId> {
    return layout.filter((entry) => !entry.hidden && entry.defaultExpanded).map((entry) => entry.id);
}

export function defaultLabelForSection(id: InboxSectionId): string {
    return DEFAULT_INBOX_SECTIONS.find((definition) => definition.id === id)?.label ?? id;
}

/**
 * Normalize a stored layout: unknown ids are dropped and missing defaults are appended.
 * Blank labels are kept so the rename field can be cleared while typing; the board falls
 * back to the Graphite name only when resolving visible definitions.
 */
export function normalizeSectionLayout(
    layout:
        | ReadonlyArray<{
              id: string;
              label?: unknown;
              hidden?: unknown;
              defaultExpanded?: unknown;
              color?: unknown;
              customColor?: unknown;
              icon?: unknown;
          }>
        | null
        | undefined,
): Array<InboxSectionLayoutEntry> {
    const defaults = defaultSectionLayout();
    const byId = new Map(defaults.map((entry) => [entry.id, entry]));

    const ordered: Array<InboxSectionLayoutEntry> = [];
    for (const entry of layout ?? []) {
        if (!isInboxSectionId(entry.id) || !byId.has(entry.id)) {
            continue;
        }

        const fallback = byId.get(entry.id)!;
        ordered.push({
            id: entry.id,
            label: typeof entry.label === "string" ? entry.label : fallback.label,
            hidden: entry.hidden === true,
            defaultExpanded:
                typeof entry.defaultExpanded === "boolean" ? entry.defaultExpanded : fallback.defaultExpanded,
            color: isSectionColorId(entry.color) ? entry.color : fallback.color,
            customColor: normalizeHexColor(entry.customColor),
            icon: isSectionIconId(entry.icon) ? entry.icon : fallback.icon,
        });
        byId.delete(entry.id);
    }

    for (const remaining of byId.values()) {
        ordered.push(remaining);
    }

    return ordered;
}

export function normalizeExpandedSections(
    ids: ReadonlyArray<unknown> | null | undefined,
    fallback: ReadonlyArray<InboxSectionId>,
): Array<InboxSectionId> {
    if (!Array.isArray(ids)) {
        return [...fallback];
    }

    const seen = new Set<InboxSectionId>();
    const next: Array<InboxSectionId> = [];
    for (const id of ids) {
        if (!isInboxSectionId(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        next.push(id);
    }
    return next;
}

/** Visible sections only, in layout order, ready for `groupIntoSections`. */
export function visibleSectionDefinitions(
    layout: ReadonlyArray<InboxSectionLayoutEntry>,
): Array<InboxSectionDefinition> {
    return normalizeSectionLayout(layout)
        .filter((entry) => !entry.hidden)
        .map((entry) => ({
            id: entry.id,
            label: entry.label.trim() || defaultLabelForSection(entry.id),
        }));
}

/**
 * Parse a portable Inbox settings payload. Throws when the document is not an object
 * with a supported version.
 */
export function parseInboxSettings(raw: unknown, fallbackExpanded: ReadonlyArray<InboxSectionId>): InboxSettings {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Inbox settings must be a JSON object.");
    }

    const document = raw as Record<string, unknown>;
    if (document.version !== INBOX_SETTINGS_VERSION) {
        throw new Error(`Unsupported Inbox settings version (expected ${INBOX_SETTINGS_VERSION}).`);
    }

    return {
        version: INBOX_SETTINGS_VERSION,
        expandedSections: normalizeExpandedSections(
            Array.isArray(document.expandedSections) ? document.expandedSections : null,
            fallbackExpanded,
        ),
        sectionLayout: normalizeSectionLayout(Array.isArray(document.sectionLayout) ? document.sectionLayout : null),
    };
}

/** Groups pull requests into the given sections, keeping empty sections visible. */
export function groupIntoSections(
    pullRequests: ReadonlyArray<PullRequestSummary>,
    viewerLogin: string,
    definitions: ReadonlyArray<InboxSectionDefinition> = DEFAULT_INBOX_SECTIONS,
): Array<InboxSection> {
    const grouped = new Map<InboxSectionId, Array<PullRequestSummary>>(
        definitions.map((definition) => [definition.id, []]),
    );

    for (const pullRequest of pullRequests) {
        grouped.get(classifyPullRequest(pullRequest, viewerLogin))?.push(pullRequest);
    }

    return definitions.map((definition) => ({
        ...definition,
        pullRequests: (grouped.get(definition.id) ?? []).sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
        ),
    }));
}
