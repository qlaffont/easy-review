import type { CheckRun, CheckState } from "#/lib/session/types.ts";

/** Raw GraphQL check / status row from `statusCheckRollup.contexts`. */
export type CheckContextInput =
    | {
          __typename: "CheckRun";
          name: string;
          status: string;
          conclusion: string | null;
          detailsUrl: string | null;
          startedAt: string | null;
          completedAt: string | null;
          checkSuite?: {
              workflowRun?: {
                  event?: string | null;
                  workflow?: { name?: string | null } | null;
              } | null;
          } | null;
      }
    | {
          __typename: "StatusContext";
          context: string;
          state: string;
          targetUrl: string | null;
      };

/** GitHub merge-box style label: `Workflow / job (event)`. */
export function checkRunDisplayName(context: Extract<CheckContextInput, { __typename: "CheckRun" }>): string {
    const workflow = context.checkSuite?.workflowRun?.workflow?.name?.trim();
    const event = context.checkSuite?.workflowRun?.event?.trim();
    if (workflow && event) {
        return `${workflow} / ${context.name} (${event})`;
    }
    if (workflow) {
        return `${workflow} / ${context.name}`;
    }
    return context.name;
}

function contextKey(context: CheckContextInput): string {
    if (context.__typename === "CheckRun") {
        return `check:${checkRunDisplayName(context)}`;
    }
    return `status:${context.context}`;
}

function contextRank(context: CheckContextInput): number {
    if (context.__typename !== "CheckRun") {
        return 0;
    }
    const stamp = context.startedAt ?? context.completedAt;
    if (!stamp) {
        return 0;
    }
    const parsed = Date.parse(stamp);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * GitHub’s PR checks popover keeps one row per check name (latest attempt).
 * `statusCheckRollup` still returns every re-run / suite attempt — collapse those here.
 */
export function selectLatestCheckContexts(
    nodes: ReadonlyArray<CheckContextInput | null | undefined>,
): Array<CheckContextInput> {
    const latest = new Map<string, { context: CheckContextInput; rank: number }>();

    for (const node of nodes) {
        if (!node) {
            continue;
        }
        const key = contextKey(node);
        const rank = contextRank(node);
        const current = latest.get(key);
        if (!current || rank >= current.rank) {
            latest.set(key, { context: node, rank });
        }
    }

    return [...latest.values()].map((entry) => entry.context);
}

/** A run GitHub has not finished is pending whatever it ends up concluding. */
export function toCheckRunState(status: string, conclusion: string | null): CheckState {
    if (status !== "COMPLETED") {
        return "pending";
    }

    switch (conclusion) {
        case "SUCCESS":
        case "NEUTRAL":
        case "SKIPPED":
            return "success";
        case "FAILURE":
        case "TIMED_OUT":
        case "CANCELLED":
        case "ACTION_REQUIRED":
        case "STARTUP_FAILURE":
            return "failure";
        default:
            return "none";
    }
}

function formatCheckDuration(startedAt: string | null, completedAt: string | null): string | null {
    if (!startedAt) {
        return null;
    }

    const start = Date.parse(startedAt);
    const end = completedAt ? Date.parse(completedAt) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return null;
    }

    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) {
        return `${Math.max(seconds, 1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (minutes < 60) {
        return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

function checkRunSummary(state: CheckState, startedAt: string | null, completedAt: string | null): string | null {
    const duration = formatCheckDuration(startedAt, completedAt);

    if (state === "failure") {
        return duration ? `Failing after ${duration}` : "Failing";
    }

    if (state === "success") {
        return duration ? `Successful in ${duration}` : "Successful";
    }

    if (state === "pending") {
        return duration ? `Running for ${duration}` : "Pending";
    }

    return null;
}

function toRollupState(state: string): CheckState {
    switch (state) {
        case "ERROR":
        case "FAILURE":
            return "failure";
        case "PENDING":
        case "EXPECTED":
            return "pending";
        case "SUCCESS":
            return "success";
        default:
            return "none";
    }
}

export function toCheckRun(context: CheckContextInput): CheckRun {
    if (context.__typename === "CheckRun") {
        const state = toCheckRunState(context.status, context.conclusion);
        return {
            name: checkRunDisplayName(context),
            state,
            url: context.detailsUrl,
            summary: checkRunSummary(state, context.startedAt, context.completedAt),
        };
    }

    const state = toRollupState(context.state);
    return {
        name: context.context,
        state,
        url: context.targetUrl,
        summary:
            state === "pending"
                ? "Pending"
                : state === "success"
                  ? "Successful"
                  : state === "failure"
                    ? "Failing"
                    : null,
    };
}

/** Map rollup contexts the way the PR checks popover should list them. */
export function mapCheckRuns(nodes: ReadonlyArray<CheckContextInput | null | undefined>): Array<CheckRun> {
    return selectLatestCheckContexts(nodes).map(toCheckRun);
}
