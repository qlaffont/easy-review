/**
 * Opt-in measurement of what each GitHub GraphQL query really costs. While on, every `query`
 * operation also asks for `rateLimit { cost remaining }` (free) and the totals add up per
 * operation. Drive it from the browser console:
 *
 *   easyReviewGithubCost.start()   // reloads nothing; measures from now on, in this tab
 *   … click Refresh, open sections, …
 *   easyReviewGithubCost.report()  // console.table per operation + total
 *   easyReviewGithubCost.stop()
 */

const STORAGE_KEY = "easy-review:measure-github-cost";
/** Alias for the probe in responses; removed before the data reaches the app. */
export const QUERY_COST_ALIAS = "easyReviewQueryCost";

const OPERATION = /\bquery\s+(EasyReview\w*)\s*(\([^)]*\))?\s*\{/;

export type QueryCostEntry = {
    operation: string;
    /** `first` page size when the query has one, to tell a 10-row section from a 50-row list. */
    first: number | null;
    cost: number;
    remaining: number;
    at: string;
};

const entries: Array<QueryCostEntry> = [];

export function isQueryCostMeasured(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

/** The query with the cost probe added to its operation, or null when it is not a named query. */
export function withQueryCostProbe(query: string): string | null {
    const match = OPERATION.exec(query);
    if (!match) {
        return null;
    }
    const insertAt = match.index + match[0].length;
    return `${query.slice(0, insertAt)}\n${QUERY_COST_ALIAS}: rateLimit { cost remaining }\n${query.slice(insertAt)}`;
}

export function queryOperationName(query: string): string {
    return OPERATION.exec(query)?.[1] ?? "unknown";
}

export function recordQueryCost(entry: Omit<QueryCostEntry, "at">): void {
    entries.push({ ...entry, at: new Date().toISOString() });
}

export type QueryCostReportRow = {
    operation: string;
    calls: number;
    points: number;
};

/** Totals per operation and page size, most expensive first. */
export function queryCostReport(): { rows: Array<QueryCostReportRow>; calls: number; points: number } {
    const byKey = new Map<string, QueryCostReportRow>();
    for (const entry of entries) {
        const operation = entry.first === null ? entry.operation : `${entry.operation} (first: ${entry.first})`;
        const row = byKey.get(operation) ?? { operation, calls: 0, points: 0 };
        row.calls += 1;
        row.points += entry.cost;
        byKey.set(operation, row);
    }
    const rows = [...byKey.values()].sort((left, right) => right.points - left.points);
    return {
        rows,
        calls: rows.reduce((total, row) => total + row.calls, 0),
        points: rows.reduce((total, row) => total + row.points, 0),
    };
}

export function resetQueryCosts(): void {
    entries.length = 0;
}

/** Expose `easyReviewGithubCost` on `window` for the console. */
export function installQueryCostConsole(): void {
    if (typeof window === "undefined") {
        return;
    }

    const api = {
        start() {
            resetQueryCosts();
            try {
                window.localStorage.setItem(STORAGE_KEY, "1");
            } catch {
                console.warn("Easy Review: localStorage is blocked, cost measurement cannot start.");
                return;
            }
            console.info("Easy Review: measuring GitHub query cost. Run easyReviewGithubCost.report() when done.");
        },
        stop() {
            try {
                window.localStorage.removeItem(STORAGE_KEY);
            } catch {
                // Nothing stored.
            }
            console.info("Easy Review: cost measurement stopped.");
        },
        reset() {
            resetQueryCosts();
        },
        report() {
            const report = queryCostReport();
            console.table(report.rows);
            console.info(`Easy Review: ${report.calls} GraphQL queries, ${report.points} points.`);
            return report;
        },
        entries() {
            return [...entries];
        },
    };

    (window as unknown as { easyReviewGithubCost: typeof api }).easyReviewGithubCost = api;
}
