import type { InboxSectionId, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";
import type {
    CheckState,
    MergeableState,
    PullRequestState,
    PullRequestSummary,
    ReviewDecision,
    ReviewState,
} from "#/lib/session/types.ts";

/** Default window for the “Recently merged” preset. */
export const RECENTLY_MERGED_WITHIN_DAYS = 7;

/** Stable viewer token — never bake a concrete login into portable defaults. */
export const VIEWER_PERSON = "@me" as const;

export type PersonFilterValue = typeof VIEWER_PERSON | (string & {});

export const SECTION_FILTER_FIELDS = [
    "author",
    "assignees",
    "labels",
    "state",
    "isDraft",
    "reviewDecision",
    "reviewRequests",
    "viewerReviewState",
    "checks",
    "mergeable",
    "repository",
    "title",
    "headRefName",
    "baseRefName",
    "involvement",
    "commentCount",
    "changedFiles",
    "additions",
    "deletions",
    "updatedWithinDays",
    "mergedWithinDays",
] as const;

export type SectionFilterField = (typeof SECTION_FILTER_FIELDS)[number];

export const SECTION_FILTER_OPS = [
    "is",
    "is_not",
    "includes",
    "does_not_include",
    "contains",
    "does_not_contain",
    "gte",
    "lte",
] as const;

export type SectionFilterOp = (typeof SECTION_FILTER_OPS)[number];

/** Derived triage situations aligned with Easy Review’s former classifier language. */
export const INVOLVEMENT_KINDS = [
    "review-requested-of-me",
    "i-have-reviewed",
    "my-draft",
    "my-changes-requested",
    "my-approved",
    "my-waiting-for-reviewers",
    "merged",
    "closed",
] as const;

export type InvolvementKind = (typeof INVOLVEMENT_KINDS)[number];

export type SectionFilterCondition = {
    id: string;
    field: SectionFilterField;
    op: SectionFilterOp;
    /** String/number/boolean; person fields may be `@me`. */
    value: string | number | boolean;
};

/** One AND-group. Section matches if any case matches (OR). */
export type SectionFilterCase = {
    id: string;
    /** Optional display name for the case card. */
    name: string;
    conditions: Array<SectionFilterCondition>;
};

/**
 * DNF filter for a section.
 * Empty `cases`, or a case with no conditions, matches nothing.
 */
export type SectionFilter = {
    cases: Array<SectionFilterCase>;
};

export function emptySectionFilter(): SectionFilter {
    return { cases: [] };
}

export function newFilterId(prefix = "f"): string {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function resolvePerson(value: string, viewerLogin: string): string {
    return value === VIEWER_PERSON ? viewerLogin : value;
}

export function involvementFor(pullRequest: PullRequestSummary, viewerLogin: string): InvolvementKind | null {
    if (pullRequest.state === "merged") {
        return "merged";
    }
    if (pullRequest.state === "closed") {
        return "closed";
    }
    if (pullRequest.author === viewerLogin) {
        if (pullRequest.isDraft) {
            return "my-draft";
        }
        if (pullRequest.reviewDecision === "changes-requested") {
            return "my-changes-requested";
        }
        if (pullRequest.reviewDecision === "approved") {
            return "my-approved";
        }
        return "my-waiting-for-reviewers";
    }
    const viewerReview = pullRequest.reviewers.find((reviewer) => reviewer.login === viewerLogin);
    if (
        viewerReview &&
        (viewerReview.state === "approved" || viewerReview.state === "changes-requested") &&
        pullRequest.author !== viewerLogin
    ) {
        return "i-have-reviewed";
    }
    if (pullRequest.reviewRequests.includes(viewerLogin)) {
        return "review-requested-of-me";
    }
    if (viewerReview && viewerReview.state !== "pending") {
        return "i-have-reviewed";
    }
    return null;
}

function viewerReviewState(pullRequest: PullRequestSummary, viewerLogin: string): ReviewState | "none" {
    const viewerReview = pullRequest.reviewers.find((reviewer) => reviewer.login === viewerLogin);
    return viewerReview?.state ?? "none";
}

function compareNumber(left: number, op: SectionFilterOp, right: number): boolean {
    if (op === "is" || op === "gte") {
        return left >= right;
    }
    if (op === "lte") {
        return left <= right;
    }
    if (op === "is_not") {
        return left !== right;
    }
    return false;
}

function matchCondition(
    pullRequest: PullRequestSummary,
    condition: SectionFilterCondition,
    viewerLogin: string,
): boolean {
    const { field, op, value } = condition;

    switch (field) {
        case "author": {
            const expected = resolvePerson(String(value), viewerLogin);
            if (op === "is") return pullRequest.author === expected;
            if (op === "is_not") return pullRequest.author !== expected;
            return false;
        }
        case "assignees": {
            const expected = resolvePerson(String(value), viewerLogin);
            const has = pullRequest.assignees.includes(expected);
            if (op === "includes") return has;
            if (op === "does_not_include") return !has;
            return false;
        }
        case "labels": {
            const label = String(value).toLowerCase();
            const has = pullRequest.labels.some((entry) => entry.name.toLowerCase() === label);
            if (op === "includes") return has;
            if (op === "does_not_include") return !has;
            return false;
        }
        case "state": {
            const expected = String(value) as PullRequestState;
            if (op === "is") return pullRequest.state === expected;
            if (op === "is_not") return pullRequest.state !== expected;
            return false;
        }
        case "isDraft": {
            const expected = value === true || value === "true";
            if (op === "is") return pullRequest.isDraft === expected;
            if (op === "is_not") return pullRequest.isDraft !== expected;
            return false;
        }
        case "reviewDecision": {
            const raw = value === "" || value === "null" ? null : String(value);
            const expected = raw as ReviewDecision;
            if (op === "is") return pullRequest.reviewDecision === expected;
            if (op === "is_not") return pullRequest.reviewDecision !== expected;
            return false;
        }
        case "reviewRequests": {
            const expected = resolvePerson(String(value), viewerLogin);
            const has = pullRequest.reviewRequests.includes(expected);
            if (op === "includes") return has;
            if (op === "does_not_include") return !has;
            return false;
        }
        case "viewerReviewState": {
            const actual = viewerReviewState(pullRequest, viewerLogin);
            const expected = String(value);
            if (op === "is") return actual === expected;
            if (op === "is_not") return actual !== expected;
            return false;
        }
        case "checks": {
            const expected = String(value) as CheckState;
            if (op === "is") return pullRequest.checks === expected;
            if (op === "is_not") return pullRequest.checks !== expected;
            return false;
        }
        case "mergeable": {
            const expected = String(value) as MergeableState;
            if (op === "is") return pullRequest.mergeable === expected;
            if (op === "is_not") return pullRequest.mergeable !== expected;
            return false;
        }
        case "repository": {
            const expected = String(value);
            if (op === "is") return pullRequest.repository === expected;
            if (op === "is_not") return pullRequest.repository !== expected;
            if (op === "contains") return pullRequest.repository.toLowerCase().includes(expected.toLowerCase());
            if (op === "does_not_contain") {
                return !pullRequest.repository.toLowerCase().includes(expected.toLowerCase());
            }
            return false;
        }
        case "title": {
            const needle = String(value).toLowerCase();
            const hay = pullRequest.title.toLowerCase();
            if (op === "contains") return hay.includes(needle);
            if (op === "does_not_contain") return !hay.includes(needle);
            return false;
        }
        case "headRefName":
        case "baseRefName": {
            const hay = pullRequest[field].toLowerCase();
            const needle = String(value).toLowerCase();
            if (op === "is") return hay === needle;
            if (op === "is_not") return hay !== needle;
            if (op === "contains") return hay.includes(needle);
            if (op === "does_not_contain") return !hay.includes(needle);
            return false;
        }
        case "involvement": {
            const actual = involvementFor(pullRequest, viewerLogin);
            const expected = String(value) as InvolvementKind;
            if (op === "is") return actual === expected;
            if (op === "is_not") return actual !== expected;
            return false;
        }
        case "commentCount":
            return compareNumber(pullRequest.commentCount, op, Number(value));
        case "changedFiles":
            return compareNumber(pullRequest.changedFiles, op, Number(value));
        case "additions":
            return compareNumber(pullRequest.additions, op, Number(value));
        case "deletions":
            return compareNumber(pullRequest.deletions, op, Number(value));
        case "updatedWithinDays": {
            const days = Number(value);
            if (!Number.isFinite(days) || days < 0) return false;
            const updatedAt = Date.parse(pullRequest.updatedAt);
            if (Number.isNaN(updatedAt)) return false;
            const ageMs = Date.now() - updatedAt;
            const within = ageMs <= days * 24 * 60 * 60 * 1000;
            if (op === "is" || op === "lte") return within;
            if (op === "is_not" || op === "gte") return !within;
            return false;
        }
        case "mergedWithinDays": {
            const days = Number(value);
            if (!Number.isFinite(days) || days < 0) return false;
            const mergedAt = Date.parse(pullRequest.mergedAt ?? pullRequest.updatedAt);
            if (Number.isNaN(mergedAt)) return false;
            const ageMs = Date.now() - mergedAt;
            const within = ageMs <= days * 24 * 60 * 60 * 1000;
            if (op === "is" || op === "lte") return within;
            if (op === "is_not" || op === "gte") return !within;
            return false;
        }
        default:
            return false;
    }
}

export function matchCase(
    pullRequest: PullRequestSummary,
    filterCase: SectionFilterCase,
    viewerLogin: string,
): boolean {
    if (filterCase.conditions.length === 0) {
        return false;
    }
    return filterCase.conditions.every((condition) => matchCondition(pullRequest, condition, viewerLogin));
}

/** Empty filter or empty cases match nothing. Otherwise OR of AND-groups. */
export function matchSectionFilter(
    pullRequest: PullRequestSummary,
    filter: SectionFilter,
    viewerLogin: string,
): boolean {
    if (filter.cases.length === 0) {
        return false;
    }
    return filter.cases.some((filterCase) => matchCase(pullRequest, filterCase, viewerLogin));
}

function condition(
    field: SectionFilterField,
    op: SectionFilterOp,
    value: string | number | boolean,
): SectionFilterCondition {
    return { id: newFilterId("c"), field, op, value };
}

function namedCase(name: string, conditions: Array<SectionFilterCondition>): SectionFilterCase {
    return { id: newFilterId("case"), name, conditions };
}

function singleCaseFilter(name: string, conditions: Array<SectionFilterCondition>): SectionFilter {
    return { cases: [namedCase(name, conditions)] };
}

/** Default DNF for presets — authored to stay nearly disjoint (former exclusive classifier). */
export function defaultFilterForPreset(id: string): SectionFilter {
    switch (id) {
        case "needs-your-review":
            return singleCaseFilter("Review requested of me", [
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewRequests", "includes", VIEWER_PERSON),
                condition("viewerReviewState", "is_not", "approved"),
                condition("viewerReviewState", "is_not", "changes-requested"),
            ]);
        case "returned-to-you":
            return singleCaseFilter("My PR, changes requested", [
                condition("author", "is", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewDecision", "is", "changes-requested"),
            ]);
        case "waiting-for-reviewers-me":
            return singleCaseFilter("My open PR waiting on review", [
                condition("author", "is", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewDecision", "is_not", "changes-requested"),
                condition("reviewDecision", "is_not", "approved"),
            ]);
        case "waiting-for-reviewers":
            return singleCaseFilter("Others' open PR waiting on review", [
                condition("author", "is_not", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewDecision", "is_not", "changes-requested"),
                condition("reviewDecision", "is_not", "approved"),
                condition("reviewRequests", "does_not_include", VIEWER_PERSON),
            ]);
        case "approved":
            return singleCaseFilter("My PR approved", [
                condition("author", "is", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewDecision", "is", "approved"),
            ]);
        case "drafts":
            return singleCaseFilter("My drafts", [
                condition("author", "is", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", true),
            ]);
        case "merging-and-recently-merged":
            return singleCaseFilter("Merged recently", [
                condition("state", "is", "merged"),
                condition("mergedWithinDays", "is", RECENTLY_MERGED_WITHIN_DAYS),
            ]);
        case "waiting-for-author":
            return singleCaseFilter("I reviewed, ball in their court", [
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("author", "is_not", VIEWER_PERSON),
                condition("involvement", "is", "i-have-reviewed"),
            ]);
        default:
            return emptySectionFilter();
    }
}

/** Which GitHub inbox connection to paginate when the user loads more rows in a section. */
export function inboxFetchStateForSection(sectionId: InboxSectionId, filter: SectionFilter): "open" | "merged" {
    if (sectionId === "merging-and-recently-merged") {
        return "merged";
    }

    const requiresMerged =
        filter.cases.length > 0 &&
        filter.cases.every((case_) =>
            case_.conditions.some(
                (condition) => condition.field === "state" && condition.op === "is" && condition.value === "merged",
            ),
        );

    return requiresMerged ? "merged" : "open";
}

export type SectionRecipeId =
    | "needs-your-review"
    | "returned-to-you"
    | "waiting-for-reviewers-me"
    | "waiting-for-reviewers"
    | "approved"
    | "drafts"
    | "merging-and-recently-merged"
    | "waiting-for-author"
    | "assigned-to-me";

export type SectionRecipe = {
    id: SectionRecipeId;
    label: string;
    description: string;
    filter: SectionFilter;
    /** Suggested label when creating a custom section from this recipe. */
    suggestedLabel: string;
    color: SectionColorId;
    icon: SectionIconId;
};

export const SECTION_RECIPES: ReadonlyArray<SectionRecipe> = [
    {
        id: "needs-your-review",
        label: "Needs your review",
        description: "Open, non-draft, review requested of you.",
        filter: defaultFilterForPreset("needs-your-review"),
        suggestedLabel: "Needs your review",
        color: "amber",
        icon: "eye",
    },
    {
        id: "returned-to-you",
        label: "Returned to you",
        description: "Your open PR with changes requested.",
        filter: defaultFilterForPreset("returned-to-you"),
        suggestedLabel: "Returned to you",
        color: "rose",
        icon: "undo",
    },
    {
        id: "waiting-for-reviewers-me",
        label: "Waiting for reviewers (me)",
        description: "Your open PR not yet approved or blocked.",
        filter: defaultFilterForPreset("waiting-for-reviewers-me"),
        suggestedLabel: "Waiting for reviewers (me)",
        color: "sky",
        icon: "users",
    },
    {
        id: "waiting-for-reviewers",
        label: "Waiting for reviewers",
        description: "Others' open PRs waiting on review — not requested of you.",
        filter: defaultFilterForPreset("waiting-for-reviewers"),
        suggestedLabel: "Waiting for reviewers",
        color: "sky",
        icon: "users",
    },
    {
        id: "approved",
        label: "Approved",
        description: "Your open PR that is fully approved.",
        filter: defaultFilterForPreset("approved"),
        suggestedLabel: "Approved",
        color: "emerald",
        icon: "check",
    },
    {
        id: "drafts",
        label: "Drafts",
        description: "Your draft pull requests.",
        filter: defaultFilterForPreset("drafts"),
        suggestedLabel: "Drafts",
        color: "slate",
        icon: "draft",
    },
    {
        id: "merging-and-recently-merged",
        label: "Recently merged",
        description: `Merged pull requests from the last ${RECENTLY_MERGED_WITHIN_DAYS} days.`,
        filter: defaultFilterForPreset("merging-and-recently-merged"),
        suggestedLabel: "Recently merged",
        color: "violet",
        icon: "merge",
    },
    {
        id: "waiting-for-author",
        label: "Waiting for author",
        description: "You reviewed; no outstanding request of you.",
        filter: defaultFilterForPreset("waiting-for-author"),
        suggestedLabel: "Waiting for author",
        color: "teal",
        icon: "hourglass",
    },
    {
        id: "assigned-to-me",
        label: "Assigned to me",
        description: "Open PRs where you are an assignee.",
        filter: singleCaseFilter("Assigned to me", [
            condition("state", "is", "open"),
            condition("assignees", "includes", VIEWER_PERSON),
        ]),
        suggestedLabel: "Assigned to me",
        color: "sky",
        icon: "user-check",
    },
];

function cloneFilter(filter: SectionFilter): SectionFilter {
    return {
        cases: filter.cases.map((filterCase) => ({
            id: newFilterId("case"),
            name: filterCase.name,
            conditions: filterCase.conditions.map((entry) => ({
                ...entry,
                id: newFilterId("c"),
            })),
        })),
    };
}

export function recipeById(id: SectionRecipeId): SectionRecipe | undefined {
    return SECTION_RECIPES.find((recipe) => recipe.id === id);
}

export function filterFromRecipe(id: SectionRecipeId): SectionFilter {
    const recipe = recipeById(id);
    return recipe ? cloneFilter(recipe.filter) : emptySectionFilter();
}

const FIELD_LABELS: Record<SectionFilterField, string> = {
    author: "Author",
    assignees: "Assignees",
    labels: "Labels",
    state: "PR status",
    isDraft: "Draft",
    reviewDecision: "Review decision",
    reviewRequests: "Requested reviewers",
    viewerReviewState: "My review",
    checks: "Checks",
    mergeable: "Mergeable",
    repository: "Repository",
    title: "Title",
    headRefName: "Head branch",
    baseRefName: "Base branch",
    involvement: "Involvement",
    commentCount: "Comments",
    changedFiles: "Changed files",
    additions: "Additions",
    deletions: "Deletions",
    updatedWithinDays: "Updated (days)",
    mergedWithinDays: "Merged (days)",
};

const OP_LABELS: Record<SectionFilterOp, string> = {
    is: "is",
    is_not: "is not",
    includes: "include",
    does_not_include: "do not include",
    contains: "contains",
    does_not_contain: "does not contain",
    gte: "≥",
    lte: "≤",
};

function formatConditionValue(condition: SectionFilterCondition): string {
    if (condition.field === "isDraft") {
        return condition.value === true || condition.value === "true" ? "yes" : "no";
    }
    if (condition.value === VIEWER_PERSON) {
        return "@me";
    }
    if (condition.value === null || condition.value === "null") {
        return "none";
    }
    return String(condition.value);
}

export function summarizeCondition(condition: SectionFilterCondition): string {
    return `${FIELD_LABELS[condition.field]} ${OP_LABELS[condition.op]} ${formatConditionValue(condition)}`;
}

export function summarizeCase(filterCase: SectionFilterCase): string {
    if (filterCase.conditions.length === 0) {
        return filterCase.name.trim() || "No conditions (matches nothing)";
    }
    const body = filterCase.conditions.map(summarizeCondition).join(" · ");
    const name = filterCase.name.trim();
    return name ? `${name}: ${body}` : body;
}

/** One-line plain-language summary for collapsed section rows. */
export function summarizeSectionFilter(filter: SectionFilter): string {
    if (filter.cases.length === 0) {
        return "No filters — matches nothing";
    }
    if (filter.cases.length === 1) {
        return summarizeCase(filter.cases[0]!);
    }
    return filter.cases
        .map((filterCase, index) => {
            const label = filterCase.name.trim() || `Case ${index + 1}`;
            return label;
        })
        .join(" OR ");
}

const FIELD_SET = new Set<string>(SECTION_FILTER_FIELDS);
const OP_SET = new Set<string>(SECTION_FILTER_OPS);

export function normalizeSectionFilter(raw: unknown, fallback: SectionFilter = emptySectionFilter()): SectionFilter {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return cloneFilter(fallback);
    }

    const document = raw as { cases?: unknown };
    if (!Array.isArray(document.cases)) {
        return cloneFilter(fallback);
    }

    const cases: Array<SectionFilterCase> = [];
    for (const entry of document.cases) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const row = entry as { id?: unknown; name?: unknown; conditions?: unknown };
        const conditions: Array<SectionFilterCondition> = [];
        if (Array.isArray(row.conditions)) {
            for (const conditionEntry of row.conditions) {
                if (conditionEntry === null || typeof conditionEntry !== "object" || Array.isArray(conditionEntry)) {
                    continue;
                }
                const cond = conditionEntry as {
                    id?: unknown;
                    field?: unknown;
                    op?: unknown;
                    value?: unknown;
                };
                if (typeof cond.field !== "string" || !FIELD_SET.has(cond.field)) {
                    continue;
                }
                if (typeof cond.op !== "string" || !OP_SET.has(cond.op)) {
                    continue;
                }
                if (
                    typeof cond.value !== "string" &&
                    typeof cond.value !== "number" &&
                    typeof cond.value !== "boolean"
                ) {
                    continue;
                }
                conditions.push({
                    id: typeof cond.id === "string" && cond.id.length > 0 ? cond.id : newFilterId("c"),
                    field: cond.field as SectionFilterField,
                    op: cond.op as SectionFilterOp,
                    value: cond.value,
                });
            }
        }
        cases.push({
            id: typeof row.id === "string" && row.id.length > 0 ? row.id : newFilterId("case"),
            name: typeof row.name === "string" ? row.name : "",
            conditions,
        });
    }

    return { cases };
}

export function opsForField(field: SectionFilterField): Array<SectionFilterOp> {
    switch (field) {
        case "assignees":
        case "labels":
        case "reviewRequests":
            return ["includes", "does_not_include"];
        case "title":
            return ["contains", "does_not_contain"];
        case "headRefName":
        case "baseRefName":
        case "repository":
            return ["is", "is_not", "contains", "does_not_contain"];
        case "commentCount":
        case "changedFiles":
        case "additions":
        case "deletions":
            return ["gte", "lte", "is"];
        case "updatedWithinDays":
        case "mergedWithinDays":
            return ["is", "is_not"];
        default:
            return ["is", "is_not"];
    }
}

export function defaultValueForField(field: SectionFilterField): string | number | boolean {
    switch (field) {
        case "author":
        case "assignees":
        case "reviewRequests":
            return VIEWER_PERSON;
        case "labels":
            return "";
        case "state":
            return "open";
        case "isDraft":
            return false;
        case "reviewDecision":
            return "approved";
        case "viewerReviewState":
            return "approved";
        case "checks":
            return "success";
        case "mergeable":
            return "mergeable";
        case "repository":
        case "title":
        case "headRefName":
        case "baseRefName":
            return "";
        case "involvement":
            return "review-requested-of-me";
        case "commentCount":
        case "changedFiles":
        case "additions":
        case "deletions":
            return 0;
        case "updatedWithinDays":
            return 14;
        case "mergedWithinDays":
            return RECENTLY_MERGED_WITHIN_DAYS;
        default:
            return "";
    }
}

/** GitHub search date qualifier (`merged:>YYYY-MM-DD`). */
function formatGitHubSearchDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function daysBeforeToday(days: number): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date;
}

function quoteGitHubSearchValue(value: string): string {
    if (/^[A-Za-z0-9._/-]+$/.test(value)) {
        return value;
    }
    return `"${value.replaceAll('"', "")}"`;
}

function conditionToSearchToken(condition: SectionFilterCondition, viewerLogin: string): string | null {
    const { field, op, value } = condition;

    switch (field) {
        case "state":
            if (op === "is" && value === "open") return "is:open";
            if (op === "is" && value === "merged") return "is:merged";
            if (op === "is" && value === "closed") return "is:closed";
            return null;
        case "isDraft":
            if (op === "is" && value === true) return "draft:true";
            if (op === "is" && value === false) return "draft:false";
            return null;
        case "mergedWithinDays": {
            if (op !== "is" && op !== "lte") return null;
            const days = Number(value);
            if (!Number.isFinite(days) || days < 0) return null;
            return `merged:>${formatGitHubSearchDate(daysBeforeToday(days))}`;
        }
        case "updatedWithinDays": {
            if (op !== "is" && op !== "lte") return null;
            const days = Number(value);
            if (!Number.isFinite(days) || days < 0) return null;
            return `updated:>${formatGitHubSearchDate(daysBeforeToday(days))}`;
        }
        case "author": {
            const login = resolvePerson(String(value), viewerLogin);
            if (op === "is") return `author:${login}`;
            if (op === "is_not") return `-author:${login}`;
            return null;
        }
        case "reviewRequests": {
            const login = resolvePerson(String(value), viewerLogin);
            if (op === "includes") return `review-requested:${login}`;
            if (op === "does_not_include") return `-review-requested:${login}`;
            return null;
        }
        case "reviewDecision":
            if (op === "is" && value === "approved") return "review:approved";
            if (op === "is" && value === "changes-requested") return "review:changes_requested";
            if (op === "is_not" && value === "approved") return "-review:approved";
            if (op === "is_not" && value === "changes-requested") return "-review:changes_requested";
            return null;
        case "labels":
            if (op === "includes") return `label:${quoteGitHubSearchValue(String(value))}`;
            if (op === "does_not_include") return `-label:${quoteGitHubSearchValue(String(value))}`;
            return null;
        case "repository":
            if (op === "is") return `repo:${value}`;
            return null;
        case "assignees": {
            const login = resolvePerson(String(value), viewerLogin);
            if (op === "includes") return `assignee:${login}`;
            if (op === "does_not_include") return `-assignee:${login}`;
            return null;
        }
        case "headRefName":
            if (op === "contains") return `head:${quoteGitHubSearchValue(String(value))}`;
            return null;
        case "baseRefName":
            if (op === "contains") return `base:${quoteGitHubSearchValue(String(value))}`;
            return null;
        case "involvement":
            if (op === "is" && value === "i-have-reviewed") return `reviewed-by:${viewerLogin}`;
            return null;
        default:
            return null;
    }
}

/**
 * Build a GitHub search query for pull requests matching a section filter.
 * Returns null when the filter uses fields GitHub search cannot express (checks, mergeable, …).
 */
export function sectionFilterToSearchQuery(filter: SectionFilter, viewerLogin: string): string | null {
    if (!viewerLogin || filter.cases.length !== 1) {
        return null;
    }

    const conditions = filter.cases[0]!.conditions;
    if (conditions.length === 0) {
        return null;
    }

    const tokens: Array<string> = ["is:pr"];
    let searchableConditions = 0;

    for (const condition of conditions) {
        const token = conditionToSearchToken(condition, viewerLogin);
        if (token === null) {
            continue;
        }
        searchableConditions += 1;
        if (token.startsWith("repo:")) {
            continue;
        }
        tokens.push(token);
    }

    if (searchableConditions === 0) {
        return null;
    }

    return tokens.join(" ");
}

/** @deprecated Use {@link sectionFilterToSearchQuery}. */
export const sectionFilterToSearchCountQuery = sectionFilterToSearchQuery;

function parseSearchDateThreshold(token: string): number | null {
    const match = /^(merged|updated):>(\d{4}-\d{2}-\d{2})$/.exec(token);
    if (!match?.[2]) {
        return null;
    }
    const parsed = Date.parse(`${match[2]}T00:00:00.000Z`);
    return Number.isNaN(parsed) ? null : parsed;
}

/** Test double helper — mirrors {@link sectionFilterToSearchCountQuery} tokens. */
export function matchesSectionSearchCountQuery(
    pullRequest: PullRequestSummary,
    query: string,
    viewerLogin: string,
): boolean {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return false;
    }

    for (const token of tokens) {
        if (token === "is:pr") {
            continue;
        }

        if (token === "is:open") {
            if (pullRequest.state !== "open") return false;
            continue;
        }
        if (token === "is:merged") {
            if (pullRequest.state !== "merged") return false;
            continue;
        }
        if (token === "is:closed") {
            if (pullRequest.state !== "closed") return false;
            continue;
        }

        if (token === "draft:true") {
            if (!pullRequest.isDraft) return false;
            continue;
        }
        if (token === "draft:false") {
            if (pullRequest.isDraft) return false;
            continue;
        }

        if (token.startsWith("merged:>")) {
            const threshold = parseSearchDateThreshold(token);
            if (threshold === null) return false;
            const mergedAt = Date.parse(pullRequest.mergedAt ?? pullRequest.updatedAt);
            if (Number.isNaN(mergedAt) || mergedAt <= threshold) return false;
            continue;
        }

        if (token.startsWith("updated:>")) {
            const threshold = parseSearchDateThreshold(token);
            if (threshold === null) return false;
            const updatedAt = Date.parse(pullRequest.updatedAt);
            if (Number.isNaN(updatedAt) || updatedAt <= threshold) return false;
            continue;
        }

        if (token.startsWith("author:")) {
            if (pullRequest.author !== token.slice("author:".length)) return false;
            continue;
        }
        if (token.startsWith("-author:")) {
            if (pullRequest.author === token.slice("-author:".length)) return false;
            continue;
        }

        if (token === "review:approved") {
            if (pullRequest.reviewDecision !== "approved") return false;
            continue;
        }
        if (token === "review:changes_requested") {
            if (pullRequest.reviewDecision !== "changes-requested") return false;
            continue;
        }
        if (token === "-review:approved") {
            if (pullRequest.reviewDecision === "approved") return false;
            continue;
        }
        if (token === "-review:changes_requested") {
            if (pullRequest.reviewDecision === "changes-requested") return false;
            continue;
        }
        if (token.startsWith("review-requested:")) {
            const login = token.slice("review-requested:".length);
            if (!pullRequest.reviewRequests.includes(login)) return false;
            continue;
        }
        if (token.startsWith("-review-requested:")) {
            const login = token.slice("-review-requested:".length);
            if (pullRequest.reviewRequests.includes(login)) return false;
            continue;
        }

        if (token.startsWith("reviewed-by:")) {
            const login = token.slice("reviewed-by:".length);
            if (!pullRequest.reviewers.some((reviewer) => reviewer.login === login)) return false;
            continue;
        }

        if (token.startsWith("label:")) {
            const label = token.slice("label:".length).replaceAll(/^"|"$/g, "");
            if (!pullRequest.labels.some((entry) => entry.name === label)) return false;
            continue;
        }
        if (token.startsWith("-label:")) {
            const label = token.slice("-label:".length).replaceAll(/^"|"$/g, "");
            if (pullRequest.labels.some((entry) => entry.name === label)) return false;
            continue;
        }

        if (token.startsWith("assignee:")) {
            const login = token.slice("assignee:".length);
            if (!pullRequest.assignees.includes(login)) return false;
            continue;
        }
        if (token.startsWith("-assignee:")) {
            const login = token.slice("-assignee:".length);
            if (pullRequest.assignees.includes(login)) return false;
            continue;
        }

        if (token.startsWith("head:")) {
            const branch = token.slice("head:".length).replaceAll(/^"|"$/g, "");
            if (!pullRequest.headRefName.includes(branch)) return false;
            continue;
        }
        if (token.startsWith("base:")) {
            const branch = token.slice("base:".length).replaceAll(/^"|"$/g, "");
            if (!pullRequest.baseRefName.includes(branch)) return false;
            continue;
        }

        if (token.startsWith("repo:")) {
            if (pullRequest.repository !== token.slice("repo:".length)) return false;
            continue;
        }

        return false;
    }

    void viewerLogin;
    return true;
}
