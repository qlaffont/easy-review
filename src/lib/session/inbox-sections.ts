import type { SectionFilter } from "#/lib/session/section-filters.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import {
    defaultFilterForPreset,
    emptySectionFilter,
    matchSectionFilter,
    normalizeSectionFilter,
    summarizeSectionFilter,
} from "#/lib/session/section-filters.ts";

/** Built-in section ids. Custom sections use `custom_*`. Legacy `other` is treated as custom. */
export type PresetInboxSectionId =
    | "needs-your-review"
    | "returned-to-you"
    | "approved"
    | "waiting-for-reviewers-me"
    | "waiting-for-reviewers"
    | "drafts"
    | "merging-and-recently-merged"
    | "waiting-for-author";

export type InboxSectionId = PresetInboxSectionId | (string & {});

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
    filter: SectionFilter;
};

/** Graphite-like buckets without sacred “Other” — leftovers are a custom recipe. */
export const DEFAULT_INBOX_SECTIONS: ReadonlyArray<{ id: PresetInboxSectionId; label: string }> = [
    { id: "needs-your-review", label: "Needs your review" },
    { id: "returned-to-you", label: "Returned to you" },
    { id: "waiting-for-reviewers-me", label: "Waiting for reviewers (me)" },
    { id: "waiting-for-reviewers", label: "Waiting for reviewers" },
    { id: "approved", label: "Approved" },
    { id: "drafts", label: "Drafts" },
    { id: "merging-and-recently-merged", label: "Merging and recently merged" },
    { id: "waiting-for-author", label: "Waiting for author" },
];

export const DEFAULT_SECTION_APPEARANCE: Record<PresetInboxSectionId, { color: SectionColorId; icon: SectionIconId }> =
    {
        "needs-your-review": { color: "amber", icon: "eye" },
        "returned-to-you": { color: "rose", icon: "undo" },
        approved: { color: "emerald", icon: "check" },
        "waiting-for-reviewers-me": { color: "sky", icon: "users" },
        "waiting-for-reviewers": { color: "sky", icon: "users" },
        drafts: { color: "slate", icon: "draft" },
        "merging-and-recently-merged": { color: "violet", icon: "merge" },
        "waiting-for-author": { color: "teal", icon: "hourglass" },
    };

export const FALLBACK_SECTION_APPEARANCE: { color: SectionColorId; icon: SectionIconId } = {
    color: "muted",
    icon: "inbox",
};

export type InboxSection = InboxSectionDefinition & {
    pullRequests: Array<PullRequestSummary>;
};

/** One row of the user's Inbox layout: order in the array is display order. */
export type InboxSectionLayoutEntry = {
    id: InboxSectionId;
    /** Display label; empty or whitespace falls back to the preset/default name. */
    label: string;
    hidden: boolean;
    /** Whether the section starts expanded when there is no saved collapse state (or after reset). */
    defaultExpanded: boolean;
    color: SectionColorId;
    /** Custom accent as `#RRGGBB`; when set it overrides the preset `color` for rendering. */
    customColor: string | null;
    icon: SectionIconId;
    /** Independent DNF filter. Empty cases / empty conditions match nothing. */
    filter: SectionFilter;
    /** Presets cannot be deleted — only hidden. Customs can be deleted. */
    kind: "preset" | "custom";
};

export const INBOX_SETTINGS_VERSION = 2 as const;

/** Portable Inbox preferences: section layout including filters. */
export type InboxSettings = {
    version: typeof INBOX_SETTINGS_VERSION;
    /**
     * Configured defaults derived from each section's `defaultExpanded` flag.
     * Live open/closed state is tab-session memory only and is not persisted.
     */
    expandedSections: Array<InboxSectionId>;
    sectionLayout: Array<InboxSectionLayoutEntry>;
};

/** Single-section export document. */
export type InboxSectionExport = {
    version: typeof INBOX_SETTINGS_VERSION;
    section: InboxSectionLayoutEntry;
};

const PRESET_ID_SET = new Set<string>(DEFAULT_INBOX_SECTIONS.map((definition) => definition.id));
const COLOR_ID_SET = new Set<string>(SECTION_COLOR_IDS);
const ICON_ID_SET = new Set<string>(SECTION_ICON_IDS);

export function isSectionColorId(value: unknown): value is SectionColorId {
    return typeof value === "string" && COLOR_ID_SET.has(value);
}

export function isSectionIconId(value: unknown): value is SectionIconId {
    return typeof value === "string" && ICON_ID_SET.has(value);
}

export function isPresetInboxSectionId(value: unknown): value is PresetInboxSectionId {
    return typeof value === "string" && PRESET_ID_SET.has(value);
}

export function isCustomSectionId(value: unknown): value is string {
    return typeof value === "string" && (value.startsWith("custom_") || value === "other");
}

export function isInboxSectionId(value: unknown): value is InboxSectionId {
    return isPresetInboxSectionId(value) || isCustomSectionId(value);
}

export function newCustomSectionId(): string {
    return `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
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

/** Visible by default: Needs review → Returned → Waiting (me) → Waiting → Approved. */
const DEFAULT_HIDDEN_SECTION_IDS = new Set<PresetInboxSectionId>([
    "drafts",
    "merging-and-recently-merged",
    "waiting-for-author",
]);

const DEFAULT_EXPANDED_SECTION_IDS = new Set<PresetInboxSectionId>([
    "needs-your-review",
    "returned-to-you",
    "waiting-for-reviewers-me",
    "approved",
]);

export function defaultSectionLayout(): Array<InboxSectionLayoutEntry> {
    return DEFAULT_INBOX_SECTIONS.map((definition) => {
        const appearance = DEFAULT_SECTION_APPEARANCE[definition.id];
        return {
            id: definition.id,
            label: definition.label,
            hidden: DEFAULT_HIDDEN_SECTION_IDS.has(definition.id),
            defaultExpanded: DEFAULT_EXPANDED_SECTION_IDS.has(definition.id),
            color: appearance.color,
            customColor: null,
            icon: appearance.icon,
            filter: defaultFilterForPreset(definition.id),
            kind: "preset" as const,
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
    return DEFAULT_INBOX_SECTIONS.find((definition) => definition.id === id)?.label ?? "Custom section";
}

export function appearanceForSectionId(id: InboxSectionId): { color: SectionColorId; icon: SectionIconId } {
    if (isPresetInboxSectionId(id)) {
        return DEFAULT_SECTION_APPEARANCE[id];
    }
    return FALLBACK_SECTION_APPEARANCE;
}

function parseLayoutEntry(entry: {
    id: string;
    label?: unknown;
    hidden?: unknown;
    defaultExpanded?: unknown;
    color?: unknown;
    customColor?: unknown;
    icon?: unknown;
    filter?: unknown;
    kind?: unknown;
}): InboxSectionLayoutEntry | null {
    if (!isInboxSectionId(entry.id)) {
        return null;
    }

    const preset = isPresetInboxSectionId(entry.id);
    const kind = preset ? "preset" : "custom";
    const appearance = appearanceForSectionId(entry.id);
    const fallbackFilter = preset ? defaultFilterForPreset(entry.id) : emptySectionFilter();
    const fallbackExpanded = preset ? DEFAULT_EXPANDED_SECTION_IDS.has(entry.id as PresetInboxSectionId) : false;

    return {
        id: entry.id,
        label:
            typeof entry.label === "string"
                ? entry.label
                : preset
                  ? defaultLabelForSection(entry.id)
                  : "Custom section",
        hidden: entry.hidden === true,
        defaultExpanded: typeof entry.defaultExpanded === "boolean" ? entry.defaultExpanded : fallbackExpanded,
        color: isSectionColorId(entry.color) ? entry.color : appearance.color,
        customColor: normalizeHexColor(entry.customColor),
        icon: isSectionIconId(entry.icon) ? entry.icon : appearance.icon,
        filter: migratePresetFilter(entry.id, normalizeSectionFilter(entry.filter, fallbackFilter)),
        kind,
    };
}

/** Fingerprint a condition for legacy-default detection (ignores ids / case names). */
function conditionFingerprint(condition: { field: string; op: string; value: string | number | boolean }): string {
    const value =
        condition.field === "isDraft"
            ? condition.value === true || condition.value === "true"
                ? "true"
                : "false"
            : String(condition.value);
    return `${condition.field}|${condition.op}|${value}`;
}

/**
 * Upgrade known stale preset defaults in place. Custom edits (extra/missing conditions) are left alone.
 */
function migratePresetFilter(id: InboxSectionId, filter: SectionFilter): SectionFilter {
    if (id !== "waiting-for-reviewers") {
        return filter;
    }
    if (filter.cases.length !== 1) {
        return filter;
    }
    const fingerprints = new Set(filter.cases[0]!.conditions.map(conditionFingerprint));
    const legacy = new Set([
        "author|is_not|@me",
        "state|is|open",
        "isDraft|is|false",
        "reviewDecision|is_not|changes-requested",
        "reviewDecision|is_not|approved",
    ]);
    if (fingerprints.size !== legacy.size || [...legacy].some((entry) => !fingerprints.has(entry))) {
        return filter;
    }
    return defaultFilterForPreset("waiting-for-reviewers");
}

/**
 * Normalize a stored layout: unknown ids are dropped, missing presets are appended,
 * custom sections are kept. Blank labels are kept so the rename field can be cleared
 * while typing; the board falls back to the default name only when resolving visible definitions.
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
              filter?: unknown;
              kind?: unknown;
          }>
        | null
        | undefined,
): Array<InboxSectionLayoutEntry> {
    const defaults = defaultSectionLayout();
    const missingPresets = new Map(defaults.map((entry) => [entry.id, entry]));

    const ordered: Array<InboxSectionLayoutEntry> = [];
    const seen = new Set<string>();

    for (const entry of layout ?? []) {
        const parsed = parseLayoutEntry(entry);
        if (!parsed || seen.has(parsed.id)) {
            continue;
        }
        seen.add(parsed.id);
        missingPresets.delete(parsed.id as PresetInboxSectionId);
        ordered.push(parsed);
    }

    for (const remaining of missingPresets.values()) {
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
        if (typeof id !== "string" || !isInboxSectionId(id) || seen.has(id)) {
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
            filter: entry.filter,
        }));
}

function migrateV1Settings(document: Record<string, unknown>): InboxSettings {
    const rawLayout = Array.isArray(document.sectionLayout) ? document.sectionLayout : null;
    const migrated =
        rawLayout?.map((entry) => {
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
                return entry;
            }
            const row = entry as Record<string, unknown>;
            if (row.id === "other") {
                return {
                    ...row,
                    id: "other",
                    kind: "custom",
                    filter: emptySectionFilter(),
                };
            }
            return row;
        }) ?? null;

    const sectionLayout = normalizeSectionLayout(migrated as Parameters<typeof normalizeSectionLayout>[0]);

    return {
        version: INBOX_SETTINGS_VERSION,
        expandedSections: defaultExpandedSections(sectionLayout),
        sectionLayout,
    };
}

/**
 * Parse a portable Inbox settings payload. Throws when the document is not an object
 * with a supported version. Live expand lists in older exports are ignored in favor of
 * each section's `defaultExpanded` flag.
 */
export function parseInboxSettings(raw: unknown): InboxSettings {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Inbox settings must be a JSON object.");
    }

    const document = raw as Record<string, unknown>;
    if (document.version === 1) {
        return migrateV1Settings(document);
    }
    if (document.version !== INBOX_SETTINGS_VERSION) {
        throw new Error(`Unsupported Inbox settings version (expected ${INBOX_SETTINGS_VERSION} or 1).`);
    }

    const sectionLayout = normalizeSectionLayout(Array.isArray(document.sectionLayout) ? document.sectionLayout : null);

    return {
        version: INBOX_SETTINGS_VERSION,
        expandedSections: defaultExpandedSections(sectionLayout),
        sectionLayout,
    };
}

export function parseInboxSectionExport(raw: unknown): InboxSectionExport {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Section export must be a JSON object.");
    }
    const document = raw as Record<string, unknown>;
    if (document.version !== INBOX_SETTINGS_VERSION && document.version !== 1) {
        throw new Error(`Unsupported section export version (expected ${INBOX_SETTINGS_VERSION} or 1).`);
    }
    if (document.section === null || typeof document.section !== "object" || Array.isArray(document.section)) {
        throw new Error("Section export must include a section object.");
    }
    const parsed = parseLayoutEntry(document.section as { id: string });
    if (!parsed) {
        throw new Error("Section export has an invalid section id.");
    }
    // Imported single sections always become custom so they never collide with presets.
    const section: InboxSectionLayoutEntry = {
        ...parsed,
        id: newCustomSectionId(),
        kind: "custom",
    };
    return { version: INBOX_SETTINGS_VERSION, section };
}

export function sectionFilterSummary(entry: InboxSectionLayoutEntry): string {
    return summarizeSectionFilter(entry.filter);
}

/**
 * Groups pull requests into the given sections by independent filters (overlap allowed).
 * Empty sections stay visible. Unmatched PRs appear nowhere.
 */
export function groupIntoSections(
    pullRequests: ReadonlyArray<PullRequestSummary>,
    viewerLogin: string,
    definitions: ReadonlyArray<InboxSectionDefinition>,
): Array<InboxSection> {
    return definitions.map((definition) => ({
        ...definition,
        pullRequests: pullRequests
            .filter((pullRequest) => matchSectionFilter(pullRequest, definition.filter, viewerLogin))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    }));
}
