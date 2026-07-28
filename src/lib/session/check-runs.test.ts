import { describe, expect, it } from "vitest";

import {
    checkRunDisplayName,
    mapCheckRuns,
    selectLatestCheckContexts,
    type CheckContextInput,
} from "#/lib/session/check-runs.ts";

function checkRun(
    name: string,
    overrides: Partial<Extract<CheckContextInput, { __typename: "CheckRun" }>> = {},
): Extract<CheckContextInput, { __typename: "CheckRun" }> {
    return {
        __typename: "CheckRun",
        name,
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: `https://github.com/acme/api/runs/${name}`,
        startedAt: "2026-07-28T12:00:00.000Z",
        completedAt: "2026-07-28T12:00:06.000Z",
        checkSuite: {
            workflowRun: {
                event: "pull_request",
                workflow: { name: "Pull Request CI" },
            },
        },
        ...overrides,
    };
}

describe("checkRunDisplayName", () => {
    it("matches GitHub’s workflow / job (event) label", () => {
        expect(checkRunDisplayName(checkRun("pr-title-lint"))).toBe("Pull Request CI / pr-title-lint (pull_request)");
    });
});

describe("selectLatestCheckContexts", () => {
    it("keeps only the latest attempt when the same job ran multiple times", () => {
        const older = checkRun("pr-title-lint", {
            startedAt: "2026-07-28T12:00:00.000Z",
            completedAt: "2026-07-28T12:00:04.000Z",
            detailsUrl: "https://github.com/acme/api/runs/old",
        });
        const newer = checkRun("pr-title-lint", {
            startedAt: "2026-07-28T12:10:00.000Z",
            completedAt: "2026-07-28T12:10:06.000Z",
            detailsUrl: "https://github.com/acme/api/runs/new",
        });
        const middle = checkRun("pr-title-lint", {
            startedAt: "2026-07-28T12:05:00.000Z",
            completedAt: "2026-07-28T12:05:05.000Z",
            detailsUrl: "https://github.com/acme/api/runs/mid",
        });

        const selected = selectLatestCheckContexts([older, newer, middle]);
        expect(selected).toHaveLength(1);
        expect(selected[0]).toMatchObject({ detailsUrl: "https://github.com/acme/api/runs/new" });
    });

    it("does not collapse the same job name from different workflow events", () => {
        const pullRequest = checkRun("secret-scanning", {
            checkSuite: {
                workflowRun: { event: "pull_request", workflow: { name: "Pull Request CI" } },
            },
        });
        const push = checkRun("secret-scanning", {
            checkSuite: {
                workflowRun: { event: "push", workflow: { name: "Pull Request CI" } },
            },
            detailsUrl: "https://github.com/acme/api/runs/push",
        });

        expect(selectLatestCheckContexts([pullRequest, push])).toHaveLength(2);
    });
});

describe("mapCheckRuns", () => {
    it("produces one popover row per unique check, not every re-run", () => {
        const runs = mapCheckRuns([
            checkRun("pr-title-lint", {
                startedAt: "2026-07-28T12:00:00.000Z",
                completedAt: "2026-07-28T12:00:04.000Z",
            }),
            checkRun("pr-title-lint", {
                startedAt: "2026-07-28T12:10:00.000Z",
                completedAt: "2026-07-28T12:10:06.000Z",
            }),
            checkRun("secret-scanning", {
                startedAt: "2026-07-28T12:00:00.000Z",
                completedAt: "2026-07-28T12:00:22.000Z",
            }),
            checkRun("secret-scanning", {
                startedAt: "2026-07-28T12:05:00.000Z",
                completedAt: "2026-07-28T12:05:26.000Z",
            }),
            {
                __typename: "StatusContext",
                context: "CodeRabbit",
                state: "PENDING",
                targetUrl: null,
            },
        ]);

        expect(runs.map((run) => run.name)).toEqual([
            "Pull Request CI / pr-title-lint (pull_request)",
            "Pull Request CI / secret-scanning (pull_request)",
            "CodeRabbit",
        ]);
        expect(runs.find((run) => run.name.includes("pr-title-lint"))?.summary).toBe("Successful in 6s");
        expect(runs.find((run) => run.name === "CodeRabbit")).toMatchObject({
            state: "pending",
            summary: "Pending",
        });
    });
});
