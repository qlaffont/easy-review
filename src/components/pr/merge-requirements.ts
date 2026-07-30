import type { MergeMethod, PullRequestDetail } from "#/lib/session/types.ts";

export function reviewRequiredDescription(detail: PullRequestDetail): string {
    const count = detail.requiredApprovingReviewCount;
    if (count != null && count > 0) {
        return `At least ${count} approving ${count === 1 ? "review is" : "reviews are"} required by reviewers with write access.`;
    }
    return "At least one approving review is required before merging.";
}

export function isReviewBlocking(detail: PullRequestDetail): boolean {
    return detail.reviewDecision === "review-required" || detail.reviewDecision === "changes-requested";
}

export function isMergeBlockedByRequirements(detail: PullRequestDetail): boolean {
    if (isReviewBlocking(detail)) {
        return true;
    }

    return (
        detail.mergeStateStatus === "blocked" ||
        detail.mergeStateStatus === "unstable" ||
        detail.mergeStateStatus === "behind" ||
        detail.mergeStateStatus === "dirty"
    );
}

export function mergingBlockedDescription(detail: PullRequestDetail): string | null {
    if (detail.reviewDecision === "review-required") {
        return reviewRequiredDescription(detail);
    }
    if (detail.reviewDecision === "changes-requested") {
        return "Changes have been requested on this pull request.";
    }
    if (detail.mergeStateStatus === "unstable" || detail.checks === "failure") {
        return "Required checks have not passed.";
    }
    if (detail.mergeStateStatus === "behind") {
        return `This branch is out of date with ${detail.baseRefName}. Update it before merging.`;
    }
    if (detail.mergeStateStatus === "blocked") {
        return "This pull request does not meet the merge requirements for the base branch.";
    }
    if (detail.mergeStateStatus === "dirty" || detail.mergeable === "conflicting") {
        return `This branch has conflicts with ${detail.baseRefName}.`;
    }
    return null;
}

export function mergeFooterHint(detail: PullRequestDetail, mergeOptionsLength: number, mergeBlocked: boolean): string {
    if (mergeOptionsLength === 0) {
        return "No merge methods are enabled for this repository.";
    }
    if (detail.mergeable === "conflicting") {
        return `Conflicts with ${detail.baseRefName} — resolve them before merging.`;
    }
    if (detail.isDraft) {
        return "Draft pull requests cannot be merged.";
    }
    if (mergeBlocked) {
        return "Merging is blocked until requirements are met.";
    }
    return `Ready to land into ${detail.baseRefName}.`;
}

export function checksStatusLabel(detail: PullRequestDetail): { title: string; ok: boolean } | null {
    if (detail.checkCount === 0 && detail.checkRuns.length === 0 && detail.checks === "none") {
        return null;
    }

    if (detail.checks === "failure" || detail.mergeStateStatus === "unstable") {
        return { title: "Some checks have not passed", ok: false };
    }

    if (detail.checks === "pending") {
        return { title: "Checks are in progress", ok: false };
    }

    return { title: "All checks have passed", ok: true };
}

/** GitHub default squash/merge-commit title: PR title plus number. */
export function defaultMergeCommitTitle(detail: Pick<PullRequestDetail, "title" | "number">): string {
    return `${detail.title} (#${detail.number})`;
}

export function mergeMethodSupportsCustomCommitMessage(method: MergeMethod): boolean {
    return method === "squash" || method === "merge";
}
