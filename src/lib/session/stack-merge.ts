import type { ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import type { PullRequestSummary } from "#/lib/session/types.ts";

import { hasMergeConflicts } from "#/components/pr/merge-requirements.ts";

export type StackMergeBlockReason =
    | "draft"
    | "conflicts"
    | "review-required"
    | "changes-requested"
    | "checks-failing"
    | "behind"
    | "blocked"
    | "blocked-downstack";

export type StackMergeRowStatus =
    | { kind: "merged" }
    | { kind: "closed" }
    | { kind: "open-ready" }
    | { kind: "open-blocked"; reason: StackMergeBlockReason };

export type StackMergeRow = {
    pullRequest: PullRequestSummary;
    status: StackMergeRowStatus;
};

export type StackMergeEvaluation = {
    rows: Array<StackMergeRow>;
    /** Open, non-draft PRs to merge bottom → top when {@link canMerge} is true. */
    mergeOrder: Array<PullRequestSummary>;
    openCount: number;
    canMerge: boolean;
    blockMessage: string | null;
};

const BLOCK_REASON_LABEL: Record<StackMergeBlockReason, string> = {
    draft: "Draft",
    conflicts: "Conflicts",
    "review-required": "Review required",
    "changes-requested": "Changes requested",
    "checks-failing": "Checks failing",
    behind: "Behind base branch",
    blocked: "Not ready",
    "blocked-downstack": "Blocked downstack",
};

const BLOCK_REASON_DETAIL: Record<Exclude<StackMergeBlockReason, "blocked-downstack">, string> = {
    draft: "Draft pull requests cannot be merged.",
    conflicts: "This branch has conflicts that must be resolved.",
    "review-required": "Review is required before merging.",
    "changes-requested": "Changes have been requested on this pull request.",
    "checks-failing": "Required checks have not passed.",
    behind: "This branch is out of date with its base branch.",
    blocked: "This pull request does not meet merge requirements.",
};

/** Short badge label for a stack row (GitHub-style). */
export function stackMergeStatusLabel(status: StackMergeRowStatus): string | null {
    switch (status.kind) {
        case "merged":
            return "Merged";
        case "closed":
            return "Closed";
        case "open-ready":
            return null;
        case "open-blocked":
            return BLOCK_REASON_LABEL[status.reason];
    }
}

function ownBlockReason(pullRequest: PullRequestSummary): StackMergeBlockReason | null {
    if (pullRequest.state !== "open") {
        return null;
    }

    if (pullRequest.isDraft) {
        return "draft";
    }

    if (hasMergeConflicts(pullRequest)) {
        return "conflicts";
    }

    if (pullRequest.reviewDecision === "review-required") {
        return "review-required";
    }

    if (pullRequest.reviewDecision === "changes-requested") {
        return "changes-requested";
    }

    if (pullRequest.checks === "failure") {
        return "checks-failing";
    }

    if (pullRequest.mergeStateStatus === "behind") {
        return "behind";
    }

    if (pullRequest.mergeStateStatus === "blocked" || pullRequest.mergeStateStatus === "unstable") {
        return "blocked";
    }

    return null;
}

/** Bottom → top merge readiness for every pull request in the stack. */
export function computeStackMergeRows(pullRequests: ReadonlyArray<PullRequestSummary>): Array<StackMergeRow> {
    const ownBlocks = pullRequests.map((pullRequest) => ownBlockReason(pullRequest));
    let bottleneckIndex = -1;

    for (let index = 0; index < pullRequests.length; index++) {
        if (pullRequests[index]!.state === "open" && ownBlocks[index]) {
            bottleneckIndex = index;
            break;
        }
    }

    return pullRequests.map((pullRequest, index) => {
        if (pullRequest.state === "merged") {
            return { pullRequest, status: { kind: "merged" } as const };
        }

        if (pullRequest.state === "closed") {
            return { pullRequest, status: { kind: "closed" } as const };
        }

        if (pullRequest.state !== "open") {
            return { pullRequest, status: { kind: "closed" } as const };
        }

        const own = ownBlocks[index];
        if (own) {
            return { pullRequest, status: { kind: "open-blocked", reason: own } as const };
        }

        if (bottleneckIndex !== -1 && index > bottleneckIndex) {
            return { pullRequest, status: { kind: "open-blocked", reason: "blocked-downstack" } as const };
        }

        return { pullRequest, status: { kind: "open-ready" } as const };
    });
}

export function evaluateStackMerge(stack: ResolvedPullRequestStack): StackMergeEvaluation {
    const rows = computeStackMergeRows(stack.pullRequests);
    const openPullRequests = rows
        .map((row) => row.pullRequest)
        .filter((pullRequest) => pullRequest.state === "open" && !pullRequest.isDraft);
    const mergeOrder = rows
        .filter((row): row is StackMergeRow & { status: { kind: "open-ready" } } => row.status.kind === "open-ready")
        .map((row) => row.pullRequest);
    const canMerge = openPullRequests.length >= 2 && mergeOrder.length === openPullRequests.length;

    return {
        rows,
        mergeOrder,
        openCount: openPullRequests.length,
        canMerge,
        blockMessage: canMerge ? null : stackMergeBlockMessage(rows, openPullRequests.length),
    };
}

function stackMergeBlockMessage(rows: Array<StackMergeRow>, openCount: number): string {
    if (openCount < 2) {
        return "Need at least two open pull requests in this stack to merge as a stack.";
    }

    const blocked = rows.find((row) => row.status.kind === "open-blocked");
    if (!blocked || blocked.status.kind !== "open-blocked") {
        return "Some pull requests in this stack cannot be merged.";
    }

    if (blocked.status.reason === "blocked-downstack") {
        const bottleneck = rows.find(
            (row) => row.status.kind === "open-blocked" && row.status.reason !== "blocked-downstack",
        );
        if (bottleneck?.status.kind === "open-blocked" && bottleneck.status.reason !== "blocked-downstack") {
            return `#${bottleneck.pullRequest.number} must be mergeable before upper stack pull requests can land.`;
        }
        return "A downstack pull request must be merged before the rest of the stack.";
    }

    return `#${blocked.pullRequest.number}: ${BLOCK_REASON_DETAIL[blocked.status.reason]}`;
}

export function stackMergeMethodDescription(method: "merge" | "squash", branchCount: number): string {
    const branches = branchCount === 1 ? "this branch" : `these ${branchCount} branches`;

    if (method === "merge") {
        return `All commits from ${branches} will be added to the base branch via merge commits.`;
    }

    return `The commits from ${branches} will be combined into one commit per branch in the base branch.`;
}
