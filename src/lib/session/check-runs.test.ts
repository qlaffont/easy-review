import { describe, expect, it } from "vitest";

import {
    checkRunDisplayName,
    latestCheckState,
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

describe("jobs a newer run has not created yet", () => {
    // latomate/medical-service#405 @ f108cf3, as a GitHub App token without Actions access sees it.
    function job(
        name: string,
        suiteId: number,
        overrides: Partial<Extract<CheckContextInput, { __typename: "CheckRun" }>> = {},
    ) {
        return checkRun(name, { checkSuite: { databaseId: suiteId, workflowRun: null }, ...overrides });
    }
    const running = { status: "IN_PROGRESS", conclusion: null, completedAt: null };
    const cancelled = { conclusion: "CANCELLED" };
    const REPLACED_RUN = 114325967595;
    const LATEST_RUN = 114326551700;

    it("ignores them while the newer run is still in progress", () => {
        const nodes = [
            job("lint", REPLACED_RUN, { startedAt: "2026-11-06T09:17:11Z" }),
            job("lint", LATEST_RUN, { startedAt: "2026-11-06T09:19:10Z" }),
            job("build", REPLACED_RUN, { ...cancelled, startedAt: "2026-11-06T09:17:54Z" }),
            job("build", LATEST_RUN, { ...running, startedAt: "2026-11-06T09:19:20Z" }),
            job("build-import-client", REPLACED_RUN, { ...cancelled, startedAt: "2026-11-06T09:19:01Z" }),
        ];

        expect(mapCheckRuns(nodes).map((run) => [run.name, run.state])).toEqual([
            ["lint", "success"],
            ["build", "pending"],
        ]);
        expect(latestCheckState(nodes, "failure")).toBe("pending");
    });

    it("keeps a failure once the newer run has finished without that job", () => {
        const nodes = [
            job("build", REPLACED_RUN, cancelled),
            job("build", LATEST_RUN),
            job("build-import-client", REPLACED_RUN, cancelled),
        ];

        expect(latestCheckState(nodes, "failure")).toBe("failure");
    });

    it("keeps a failure from another workflow that only shares a job name", () => {
        const nodes = [
            job("build", REPLACED_RUN),
            job("test", REPLACED_RUN, { conclusion: "FAILURE" }),
            job("build", LATEST_RUN, running),
            job("e2e", LATEST_RUN, running),
        ];

        expect(mapCheckRuns(nodes).map((run) => run.name)).toContain("test");
        expect(latestCheckState(nodes, "failure")).toBe("failure");
    });

    it("keeps older checks from an unrelated suite", () => {
        const nodes = [job("CodeRabbit", 114325926079), job("build", LATEST_RUN, running)];

        expect(mapCheckRuns(nodes).map((run) => run.name)).toEqual(["CodeRabbit", "build"]);
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
