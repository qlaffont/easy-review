import type { MergeCommitSettings, MergeMethod, PullRequestDetail } from "#/lib/session/types.ts";

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

function formatPullRequestTitle(detail: Pick<PullRequestDetail, "title" | "number">): string {
    return `${detail.title} (#${detail.number})`;
}

function mergePullRequestTitle(detail: PullRequestDetail): string {
    return `Merge pull request #${detail.number} from ${detail.headRepositoryOwnerLogin}/${detail.headRefName}`;
}

function squashCommitBody(message: string, headline: string): string {
    const normalizedMessage = message.replace(/\r\n/g, "\n");
    const normalizedHeadline = headline.trim();
    const lines = normalizedMessage.split("\n");

    if (lines[0]?.trim() === normalizedHeadline) {
        return lines.slice(1).join("\n").replace(/^\n+/, "");
    }

    if (normalizedMessage.trim() === normalizedHeadline) {
        return "";
    }

    return normalizedMessage;
}

function formatCommitMessagesList(commits: PullRequestDetail["mergeCommits"]): string {
    return commits
        .map((commit) => {
            const shortOid = commit.oid.slice(0, 7);
            return shortOid ? `* ${commit.messageHeadline} (${shortOid})` : `* ${commit.messageHeadline}`;
        })
        .join("\n");
}

function squashTitle(detail: PullRequestDetail, settings: MergeCommitSettings): string {
    if (settings.squashMergeCommitTitle === "PR_TITLE") {
        return formatPullRequestTitle(detail);
    }

    if (detail.commitCount === 1 && detail.mergeCommits[0]) {
        return detail.mergeCommits[0].messageHeadline;
    }

    return formatPullRequestTitle(detail);
}

function squashMessage(detail: PullRequestDetail, settings: MergeCommitSettings): string {
    if (settings.squashMergeCommitMessage === "BLANK") {
        return "";
    }

    if (settings.squashMergeCommitMessage === "PR_BODY") {
        return detail.body;
    }

    if (detail.commitCount === 1 && detail.mergeCommits[0]) {
        return squashCommitBody(detail.mergeCommits[0].message, detail.mergeCommits[0].messageHeadline);
    }

    return formatCommitMessagesList(detail.mergeCommits);
}

function mergeTitle(detail: PullRequestDetail, settings: MergeCommitSettings): string {
    if (settings.mergeCommitTitle === "PR_TITLE") {
        return formatPullRequestTitle(detail);
    }

    return mergePullRequestTitle(detail);
}

function mergeMessage(detail: PullRequestDetail, settings: MergeCommitSettings): string {
    if (settings.mergeCommitMessage === "BLANK") {
        return "";
    }

    if (settings.mergeCommitMessage === "PR_BODY") {
        return detail.body;
    }

    return detail.title;
}

/** Default commit title and extended description for the merge dialog, matching GitHub repo settings. */
export function defaultMergeCommitFields(
    detail: PullRequestDetail,
    method: MergeMethod,
): { title: string; message: string } {
    if (method === "rebase") {
        return { title: "", message: "" };
    }

    const settings = detail.mergeCommitSettings;

    if (method === "squash") {
        return {
            title: squashTitle(detail, settings),
            message: squashMessage(detail, settings),
        };
    }

    return {
        title: mergeTitle(detail, settings),
        message: mergeMessage(detail, settings),
    };
}

export function mergeMethodSupportsCustomCommitMessage(method: MergeMethod): boolean {
    return method === "squash" || method === "merge";
}
