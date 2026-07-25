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
};

export function defaultSectionLayout(): Array<InboxSectionLayoutEntry> {
    return DEFAULT_INBOX_SECTIONS.map((definition) => ({
        id: definition.id,
        label: definition.label,
        hidden: false,
    }));
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
    layout: ReadonlyArray<InboxSectionLayoutEntry> | null | undefined,
): Array<InboxSectionLayoutEntry> {
    const defaults = defaultSectionLayout();
    const byId = new Map(defaults.map((entry) => [entry.id, entry]));

    const ordered: Array<InboxSectionLayoutEntry> = [];
    for (const entry of layout ?? []) {
        if (!byId.has(entry.id)) {
            continue;
        }

        ordered.push({
            id: entry.id,
            label: entry.label,
            hidden: entry.hidden === true,
        });
        byId.delete(entry.id);
    }

    for (const remaining of byId.values()) {
        ordered.push(remaining);
    }

    return ordered;
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
