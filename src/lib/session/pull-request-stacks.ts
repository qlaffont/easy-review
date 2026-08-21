import type { GithubPullRequestStack, PullRequestSummary } from "#/lib/session/types.ts";

export type ResolvedPullRequestStack = {
    repository: string;
    /** Pull requests from trunk-adjacent (bottom) to top of the stack. */
    pullRequests: Array<PullRequestSummary>;
    trunkRefName: string;
    /** Human label for the trunk node, e.g. `dev (trunk)` or `feat-a`. */
    trunkLabel: string;
    /** 1-based index of the focal pull request within {@link pullRequests}. */
    position: number;
    total: number;
};

export function formatTrunkLabel(baseRefName: string, defaultBranch: string | null): string {
    if (defaultBranch && baseRefName === defaultBranch) {
        return `${baseRefName} (trunk)`;
    }
    return baseRefName;
}

/** Resolve a stack only from GitHub's native stacked-PR membership. */
export function resolveGithubPullRequestStack(input: {
    repository: string;
    number: number;
    githubStack: GithubPullRequestStack | null | undefined;
    pullRequests: ReadonlyArray<PullRequestSummary>;
    hideClosed: boolean;
}): ResolvedPullRequestStack | null {
    if (!input.githubStack || input.githubStack.size < 2) {
        return null;
    }

    const visible = input.hideClosed
        ? input.pullRequests.filter((pullRequest) => pullRequest.state !== "closed")
        : [...input.pullRequests];

    if (visible.length < 2) {
        return null;
    }

    const position = visible.findIndex((pullRequest) => pullRequest.number === input.number) + 1;
    if (position <= 0) {
        return null;
    }

    const trunkRefName = input.githubStack.baseRefName;

    return {
        repository: input.repository,
        pullRequests: visible,
        trunkRefName,
        trunkLabel: formatTrunkLabel(trunkRefName, trunkRefName),
        position,
        total: visible.length,
    };
}

export function formatStackUrls(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => pullRequest.url).join("\n");
}

export function formatStackBranches(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => pullRequest.headRefName).join("\n");
}

export function formatStackGhCheckoutCommands(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => `gh pr checkout ${pullRequest.number}`).join("\n");
}
