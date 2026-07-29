import type { PullRequestSummary } from "#/lib/session/types.ts";

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

function findUniqueParent(
    pullRequest: PullRequestSummary,
    pullRequests: ReadonlyArray<PullRequestSummary>,
): PullRequestSummary | null {
    const candidates = pullRequests.filter(
        (candidate) => candidate.key !== pullRequest.key && candidate.headRefName === pullRequest.baseRefName,
    );
    return candidates.length === 1 ? candidates[0]! : null;
}

function findUniqueChild(
    pullRequest: PullRequestSummary,
    pullRequests: ReadonlyArray<PullRequestSummary>,
): PullRequestSummary | null {
    const candidates = pullRequests.filter(
        (candidate) => candidate.key !== pullRequest.key && candidate.baseRefName === pullRequest.headRefName,
    );
    return candidates.length === 1 ? candidates[0]! : null;
}

/** Walk parent/child links to build the linear chain containing `focal`. */
export function buildLinearStackChain(
    focal: PullRequestSummary,
    pullRequests: ReadonlyArray<PullRequestSummary>,
): Array<PullRequestSummary> {
    const chain: Array<PullRequestSummary> = [focal];

    let current = focal;
    while (true) {
        const parent = findUniqueParent(current, pullRequests);
        if (!parent || chain.some((entry) => entry.key === parent.key)) {
            break;
        }
        chain.unshift(parent);
        current = parent;
    }

    current = focal;
    while (true) {
        const child = findUniqueChild(current, pullRequests);
        if (!child || chain.some((entry) => entry.key === child.key)) {
            break;
        }
        chain.push(child);
        current = child;
    }

    return chain;
}

export function formatTrunkLabel(baseRefName: string, defaultBranch: string | null): string {
    if (defaultBranch && baseRefName === defaultBranch) {
        return `${baseRefName} (trunk)`;
    }
    return baseRefName;
}

export function resolvePullRequestStack(input: {
    repository: string;
    number: number;
    pullRequests: ReadonlyArray<PullRequestSummary>;
    defaultBranch: string | null;
    hideClosed: boolean;
}): ResolvedPullRequestStack | null {
    const scoped = input.pullRequests.filter((pullRequest) => pullRequest.repository === input.repository);
    const visible = input.hideClosed ? scoped.filter((pullRequest) => pullRequest.state !== "closed") : scoped;

    const focal = visible.find((pullRequest) => pullRequest.number === input.number);
    if (!focal) {
        return null;
    }

    const chain = buildLinearStackChain(focal, visible);
    if (chain.length < 2) {
        return null;
    }

    const position = chain.findIndex((pullRequest) => pullRequest.number === input.number) + 1;
    const bottom = chain[0]!;

    return {
        repository: input.repository,
        pullRequests: chain,
        trunkRefName: bottom.baseRefName,
        trunkLabel: formatTrunkLabel(bottom.baseRefName, input.defaultBranch),
        position,
        total: chain.length,
    };
}

export function formatStackUrls(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => pullRequest.url).join("\n");
}

export function formatStackBranches(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => pullRequest.headRefName).join("\n");
}

export function formatStackGhCheckoutCommands(stack: ResolvedPullRequestStack): string {
    return stack.pullRequests.map((pullRequest) => `gh pr checkout ${pullRequest.number}`).join(" && ");
}
