import { createFileRoute } from "@tanstack/react-router";

import { ReviewChanges } from "#/components/pr/review-changes.tsx";

export const Route = createFileRoute("/pr/$owner/$repo/$number_/files")({ component: ReviewChangesPage });

function ReviewChangesPage() {
    const { owner, repo, number } = Route.useParams();

    return <ReviewChanges repository={`${owner}/${repo}`} number={Number(number)} />;
}
