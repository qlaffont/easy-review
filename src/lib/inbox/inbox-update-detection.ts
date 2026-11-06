import type { InboxQueryData } from "#/lib/query/types.ts";
import type { InboxSectionId } from "#/lib/session/inbox-sections.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

type SectionMembership = {
    keys: ReadonlySet<string>;
    totalCount: number;
};

/** Which pull requests each loaded section holds. A section that never loaded has no entry. */
export type SectionMembershipSnapshot = ReadonlyMap<InboxSectionId, SectionMembership>;

export type NewPullRequest = {
    pullRequest: PullRequestSummary;
    sectionId: InboxSectionId;
};

export function snapshotSectionMembership(
    data: InboxQueryData | undefined,
    sectionIds: ReadonlyArray<InboxSectionId>,
): SectionMembershipSnapshot {
    const snapshot = new Map<InboxSectionId, SectionMembership>();
    if (!data) {
        return snapshot;
    }

    for (const sectionId of sectionIds) {
        const pullRequests = data.sectionPullRequests[sectionId];
        if (pullRequests) {
            snapshot.set(sectionId, {
                keys: new Set(pullRequests.map((pullRequest) => pullRequest.key)),
                totalCount: data.sectionCounts[sectionId] ?? pullRequests.length,
            });
        }
    }

    return snapshot;
}

/**
 * Pull requests that entered a watched section since `before`, one entry per pull
 * request (the first section in `sectionIds` order wins).
 *
 * Only the first page of a section is loaded, so an unseen row in a section that had
 * more rows than it loaded may just be an old pull request moving up after an update.
 * Those rows only count when the section total grew, and only up to that growth.
 */
export function detectNewPullRequests(
    before: SectionMembershipSnapshot,
    data: InboxQueryData | undefined,
    sectionIds: ReadonlyArray<InboxSectionId>,
): Array<NewPullRequest> {
    const found = new Map<string, NewPullRequest>();
    if (!data) {
        return [];
    }

    for (const sectionId of sectionIds) {
        const previous = before.get(sectionId);
        if (!previous) {
            continue;
        }

        const unseen = (data.sectionPullRequests[sectionId] ?? []).filter(
            (pullRequest) => !previous.keys.has(pullRequest.key),
        );
        const wasTruncated = previous.totalCount > previous.keys.size;
        const growth = (data.sectionCounts[sectionId] ?? 0) - previous.totalCount;
        const entered = wasTruncated ? unseen.slice(0, Math.max(0, growth)) : unseen;

        for (const pullRequest of entered) {
            if (!found.has(pullRequest.key)) {
                found.set(pullRequest.key, { pullRequest, sectionId });
            }
        }
    }

    return [...found.values()];
}
