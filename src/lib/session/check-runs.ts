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
              /** Grows with each suite, so it orders runs when `workflowRun` is unreadable. */
              databaseId?: number | null;
              /** Null unless the token has Actions read access. */
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

function suiteIdOf(context: CheckContextInput): number | null {
    return context.__typename === "CheckRun" ? (context.checkSuite?.databaseId ?? null) : null;
}

/**
 * A run in progress has not created the jobs waiting on its earlier ones, so those jobs only
 * exist in the runs it replaces, and GitHub lists none of them until the new run gets there.
 *
 * The workflow is often unreadable, so a run counts as replaced when the running suite's checks
 * are all among its own. Requiring the suite to still be running means a wrong match can only
 * hide a check until that suite finishes, and the commit reads as pending, never as passed.
 */
function withoutChecksAwaitingRunningSuite(contexts: Array<CheckContextInput>): Array<CheckContextInput> {
    const keysBySuite = new Map<number, Set<string>>();
    const runningSuiteIds = new Set<number>();

    for (const context of contexts) {
        const suiteId = suiteIdOf(context);
        if (suiteId === null || context.__typename !== "CheckRun") {
            continue;
        }
        const keys = keysBySuite.get(suiteId) ?? new Set<string>();
        keys.add(contextKey(context));
        keysBySuite.set(suiteId, keys);
        if (context.status !== "COMPLETED") {
            runningSuiteIds.add(suiteId);
        }
    }

    return contexts.filter((context) => {
        const suiteId = suiteIdOf(context);
        const suiteKeys = suiteId === null ? undefined : keysBySuite.get(suiteId);
        if (suiteId === null || !suiteKeys) {
            return true;
        }
        const key = contextKey(context);
        return ![...runningSuiteIds].some((runningId) => {
            const runningKeys = keysBySuite.get(runningId);
            return (
                runningKeys !== undefined &&
                runningId > suiteId &&
                !runningKeys.has(key) &&
                [...runningKeys].every((runningKey) => suiteKeys.has(runningKey))
            );
        });
    });
}

/**
 * GitHub’s PR checks popover keeps one row per check name (latest attempt).
 * `statusCheckRollup` still returns every re-run / suite attempt — collapse those here.
 */
export function selectLatestCheckContexts(
    nodes: ReadonlyArray<CheckContextInput | null | undefined>,
): Array<CheckContextInput> {
    const latest = new Map<string, { context: CheckContextInput; rank: number }>();
    const visible = withoutChecksAwaitingRunningSuite(nodes.filter((node) => node != null));

    for (const node of visible) {
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

/**
 * Match GitHub's checks popover: superseded attempts do not keep a commit red.
 * Fall back to the aggregate when GitHub redacts any context, since the visible
 * subset is then insufficient to derive a trustworthy state.
 */
export function latestCheckState(
    nodes: ReadonlyArray<CheckContextInput | null | undefined>,
    aggregateState: CheckState,
): CheckState {
    if (nodes.length === 0 || nodes.some((node) => node == null)) {
        return aggregateState;
    }

    const states = selectLatestCheckContexts(nodes).map((context) => toCheckRun(context).state);
    if (states.includes("failure")) {
        return "failure";
    }
    if (states.includes("pending")) {
        return "pending";
    }
    if (states.includes("success")) {
        return "success";
    }
    return aggregateState;
}

/** Map rollup contexts the way the PR checks popover should list them. */
export function mapCheckRuns(nodes: ReadonlyArray<CheckContextInput | null | undefined>): Array<CheckRun> {
    return selectLatestCheckContexts(nodes).map(toCheckRun);
}
