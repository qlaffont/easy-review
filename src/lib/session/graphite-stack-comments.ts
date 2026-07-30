import type { PullRequestSummary } from "#/lib/session/types.ts";

import { type ResolvedPullRequestStack, formatTrunkLabel } from "#/lib/session/pull-request-stacks.ts";

export type ParsedGraphiteStackComment = {
    /** Pull request numbers from stack top to trunk-adjacent bottom, as listed in the comment. */
    numbersTopToBottom: Array<number>;
    focalNumber: number;
    trunkRefName: string | null;
};

const GRAPHITE_STACK_MARKER = /managed by\s+<a[^>]*>\s*Graphite\s*<\/a>|managed by\s+Graphite|stacking\.dev/i;

/** Parse the auto-generated Graphite stack comment on a pull request. */
export function parseGraphiteStackComment(body: string): ParsedGraphiteStackComment | null {
    if (!GRAPHITE_STACK_MARKER.test(body)) {
        return null;
    }

    const numbersTopToBottom: Array<number> = [];
    let focalNumber: number | null = null;
    let trunkRefName: string | null = null;

    for (const line of body.split("\n")) {
        const pullRequestMatch = /^\*\s+\*\*#(\d+)\*\*/.exec(line.trim());
        if (pullRequestMatch) {
            const parsed = Number(pullRequestMatch[1]);
            if (Number.isSafeInteger(parsed) && parsed > 0) {
                numbersTopToBottom.push(parsed);
                if (line.includes("👈")) {
                    focalNumber = parsed;
                }
            }
            continue;
        }

        const trunkMatch = /^\*\s+`([^`]+)`/.exec(line.trim());
        if (trunkMatch?.[1]) {
            trunkRefName = trunkMatch[1]!.trim();
        }
    }

    if (numbersTopToBottom.length < 2) {
        return null;
    }

    if (focalNumber == null) {
        focalNumber = numbersTopToBottom[0]!;
    }

    return {
        numbersTopToBottom,
        focalNumber,
        trunkRefName,
    };
}

export function resolveStackFromGraphiteComment(input: {
    repository: string;
    number: number;
    comment: ParsedGraphiteStackComment;
    pullRequests: ReadonlyArray<PullRequestSummary>;
    defaultBranch: string | null;
    hideClosed: boolean;
}): ResolvedPullRequestStack | null {
    const byNumber = new Map(input.pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]));
    const bottomToTop = [...input.comment.numbersTopToBottom].reverse();
    const chain = bottomToTop.flatMap((entry: number) => {
        const pullRequest = byNumber.get(entry);
        return pullRequest ? [pullRequest] : [];
    });

    if (chain.length < 2) {
        return null;
    }

    const visible = input.hideClosed ? chain.filter((pullRequest) => pullRequest.state !== "closed") : chain;
    if (visible.length < 2) {
        return null;
    }

    const position = visible.findIndex((pullRequest) => pullRequest.number === input.number) + 1;
    if (position <= 0) {
        return null;
    }

    const bottom = visible[0]!;
    const trunkRefName = input.comment.trunkRefName ?? bottom.baseRefName;

    return {
        repository: input.repository,
        pullRequests: visible,
        trunkRefName,
        trunkLabel: formatTrunkLabel(trunkRefName, input.defaultBranch),
        position,
        total: visible.length,
    };
}
