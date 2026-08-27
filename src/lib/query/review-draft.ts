import { useSelector } from "@tanstack/react-store";

import type { ReviewDraft } from "#/lib/session/types.ts";

import { useSession } from "#/lib/session/provider.tsx";

/** Staged review draft — client state, stays on the session store. */
export function useReviewDraft(repository: string, number: number): ReviewDraft {
    const session = useSession();
    return useSelector(session.state, () => session.getReviewDraft(repository, number));
}

/**
 * Files-changed surface: comments and staleness only. Changing the review event
 * (Comment / Approve / Request changes) must not re-render the diff viewer.
 */
export function useReviewDraftStaging(repository: string, number: number): Pick<ReviewDraft, "comments" | "stale"> {
    const session = useSession();
    return useSelector(
        session.state,
        () => {
            const draft = session.getReviewDraft(repository, number);
            return { comments: draft.comments, stale: draft.stale };
        },
        {
            compare: (left, right) => left.comments === right.comments && left.stale === right.stale,
        },
    );
}
