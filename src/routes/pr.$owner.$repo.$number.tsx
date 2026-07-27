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

    return <PullRequestOverview repository={`${owner}/${repo}`} number={Number(number)} initialPath={path} />;
}
