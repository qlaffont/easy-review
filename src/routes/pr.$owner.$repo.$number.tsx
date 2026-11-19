import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PullRequestOverview } from "#/components/pr/pull-request-overview.tsx";
import { pullRequestHead } from "#/lib/seo.ts";

const searchSchema = z.object({
    path: z.string().optional(),
});

export const Route = createFileRoute("/pr/$owner/$repo/$number")({
    validateSearch: searchSchema,
    head: ({ params }) =>
        pullRequestHead({
            owner: params.owner,
            repo: params.repo,
            number: params.number,
        }),
    component: PullRequestPage,
});

function PullRequestPage() {
    const { owner, repo, number } = Route.useParams();
    const { path } = Route.useSearch();

    // Keyed per PR: switching PRs remounts the page like a fresh open from the inbox (tab, review
    // state, scroll sentinel) instead of reusing the previous PR's component state.
    return (
        <PullRequestOverview
            key={`${owner}/${repo}#${number}`}
            repository={`${owner}/${repo}`}
            number={Number(number)}
            initialPath={path}
        />
    );
}
