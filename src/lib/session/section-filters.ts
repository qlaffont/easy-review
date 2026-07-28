import type { SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";
import type {
    CheckState,
    MergeableState,
    PullRequestState,
    PullRequestSummary,
    ReviewDecision,
    ReviewState,
} from "#/lib/session/types.ts";

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
    if (pullRequest.reviewRequests.includes(viewerLogin)) {
        return "review-requested-of-me";
    }
    const viewerReview = pullRequest.reviewers.find((reviewer) => reviewer.login === viewerLogin);
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
            return singleCaseFilter("My open PR waiting on review", [
                condition("author", "is_not", VIEWER_PERSON),
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("reviewDecision", "is_not", "changes-requested"),
                condition("reviewDecision", "is_not", "approved"),
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
                condition("isDraft", "is", true),
            ]);
        case "merging-and-recently-merged":
            return singleCaseFilter("Merged", [condition("state", "is", "merged")]);
        case "waiting-for-author":
            return singleCaseFilter("I reviewed, ball in their court", [
                condition("state", "is", "open"),
                condition("isDraft", "is", false),
                condition("author", "is_not", VIEWER_PERSON),
                condition("reviewRequests", "does_not_include", VIEWER_PERSON),
                condition("involvement", "is", "i-have-reviewed"),
            ]);
        default:
            return emptySectionFilter();
    }
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
        description: "Others' open PRs not yet approved or blocked.",
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
        label: "Merging and recently merged",
        description: "Merged pull requests.",
        filter: defaultFilterForPreset("merging-and-recently-merged"),
        suggestedLabel: "Merging and recently merged",
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
    reviewRequests: "Active reviewers",
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
        default:
            return "";
    }
}
