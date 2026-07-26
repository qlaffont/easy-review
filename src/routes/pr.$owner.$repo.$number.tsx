import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PullRequestOverview } from "#/components/pr/pull-request-overview.tsx";

const searchSchema = z.object({
    path: z.string().optional(),
});

export const Route = createFileRoute("/pr/$owner/$repo/$number")({
    validateSearch: searchSchema,
    component: PullRequestPage,
});

function PullRequestPage() {
    const { owner, repo, number } = Route.useParams();
    const { path } = Route.useSearch();

    return <PullRequestOverview repository={`${owner}/${repo}`} number={Number(number)} initialPath={path} />;
}
