import { createFileRoute } from "@tanstack/react-router";

import { PullRequestOverview } from "#/components/pr/pull-request-overview.tsx";

export const Route = createFileRoute("/pr/$owner/$repo/$number")({ component: PullRequestPage });

function PullRequestPage() {
    const { owner, repo, number } = Route.useParams();

    return <PullRequestOverview repository={`${owner}/${repo}`} number={Number(number)} />;
}
