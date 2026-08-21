import { useMemo } from "react";

import type { PullRequestSummary } from "#/lib/session/types.ts";

import { useStackPreferences } from "#/lib/stack-preferences.ts";

export type InboxStackBadge = {
    position: number;
    total: number;
};

/** Stack position badges for inbox rows, keyed by pull request key. */
export function useInboxStackBadges(pullRequests: ReadonlyArray<PullRequestSummary>): Map<string, InboxStackBadge> {
    const [stackPreferences] = useStackPreferences();

    return useMemo(() => {
        const badges = new Map<string, InboxStackBadge>();
        if (!stackPreferences.enabled) {
            return badges;
        }

        for (const pullRequest of pullRequests) {
            const stack = pullRequest.githubStack;
            if (stack && stack.size > 1) {
                badges.set(pullRequest.key, { position: stack.position, total: stack.size });
            }
        }

        return badges;
    }, [stackPreferences.enabled, pullRequests]);
}
