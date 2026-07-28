import { GitCommitHorizontal } from "lucide-react";

import type { PullRequestCommit } from "#/lib/session/types.ts";

import { cn } from "#/lib/utils.ts";

/** Full PR diff vs an explicit `base...head` commit range. */
export type CommitRangeValue = { mode: "all" } | { mode: "range"; baseOid: string; headOid: string };

const BASE_VALUE = "__base__";

function shortOid(oid: string): string {
    return oid.slice(0, 7);
}

function commitLabel(commit: PullRequestCommit): string {
    const headline = commit.messageHeadline.trim() || "(no message)";
    return `${shortOid(commit.oid)} · ${headline}`;
}

/**
 * Resolve UI select values into a range. `from` is exclusive (git A in A...B);
 * `to` is inclusive. `from=base` + `to=last commit` is treated as the full PR.
 */
export function rangeFromSelectValues(
    fromValue: string,
    toValue: string,
    commits: ReadonlyArray<PullRequestCommit>,
    baseSha: string,
): CommitRangeValue {
    if (commits.length === 0) {
        return { mode: "all" };
    }

    const last = commits[commits.length - 1]!;
    const baseOid = fromValue === BASE_VALUE ? baseSha : fromValue;
    const headOid = toValue;

    if (!baseOid || !headOid) {
        return { mode: "all" };
    }

    if (fromValue === BASE_VALUE && headOid === last.oid) {
        return { mode: "all" };
    }

    return { mode: "range", baseOid, headOid };
}

export function selectValuesFromRange(
    range: CommitRangeValue,
    commits: ReadonlyArray<PullRequestCommit>,
    baseSha: string,
): { from: string; to: string } {
    const last = commits[commits.length - 1];
    if (range.mode === "all" || !last) {
        return { from: BASE_VALUE, to: last?.oid ?? "" };
    }

    const from = range.baseOid === baseSha ? BASE_VALUE : range.baseOid;
    return { from, to: range.headOid };
}

/** Allowed “to” commits must come after the selected “from” in PR history. */
export function toCommitOptions(
    commits: ReadonlyArray<PullRequestCommit>,
    fromValue: string,
): Array<PullRequestCommit> {
    if (fromValue === BASE_VALUE) {
        return [...commits];
    }
    const index = commits.findIndex((commit) => commit.oid === fromValue);
    if (index < 0) {
        return [...commits];
    }
    return commits.slice(index + 1);
}

export function CommitRangePicker({
    commits,
    baseSha,
    range,
    onChange,
    disabled,
}: {
    commits: ReadonlyArray<PullRequestCommit>;
    baseSha: string;
    range: CommitRangeValue;
    onChange: (next: CommitRangeValue) => void;
    disabled?: boolean;
}) {
    if (commits.length <= 1 || !baseSha) {
        return null;
    }

    const selected = selectValuesFromRange(range, commits, baseSha);
    const toOptions = toCommitOptions(commits, selected.from);
    const toValue = toOptions.some((commit) => commit.oid === selected.to)
        ? selected.to
        : (toOptions[toOptions.length - 1]?.oid ?? selected.to);

    function emit(fromValue: string, toNext: string) {
        onChange(rangeFromSelectValues(fromValue, toNext, commits, baseSha));
    }

    return (
        <div
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            role="group"
            aria-label="Changes from commit range"
        >
            <GitCommitHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0">Changes from</span>
            <select
                className={cn(
                    "h-7 max-w-[14rem] truncate rounded-md border bg-background px-1.5 text-xs text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label="Base commit"
                disabled={disabled}
                value={selected.from}
                onChange={(event) => {
                    const nextFrom = event.target.value;
                    const nextToOptions = toCommitOptions(commits, nextFrom);
                    const nextTo = nextToOptions.some((commit) => commit.oid === toValue)
                        ? toValue
                        : (nextToOptions[nextToOptions.length - 1]?.oid ?? toValue);
                    emit(nextFrom, nextTo);
                }}
            >
                <option value={BASE_VALUE}>Base ({shortOid(baseSha)})</option>
                {commits.slice(0, -1).map((commit) => (
                    <option key={commit.oid} value={commit.oid}>
                        {commitLabel(commit)}
                    </option>
                ))}
            </select>
            <span className="shrink-0" aria-hidden="true">
                …
            </span>
            <select
                className={cn(
                    "h-7 max-w-[14rem] truncate rounded-md border bg-background px-1.5 text-xs text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label="Head commit"
                disabled={disabled}
                value={toValue}
                onChange={(event) => emit(selected.from, event.target.value)}
            >
                {toOptions.map((commit) => (
                    <option key={commit.oid} value={commit.oid}>
                        {commitLabel(commit)}
                    </option>
                ))}
            </select>
            {range.mode === "range" ? (
                <button
                    type="button"
                    className="h-7 shrink-0 rounded-md px-1.5 text-xs text-sky-700 hover:underline dark:text-sky-400"
                    disabled={disabled}
                    onClick={() => onChange({ mode: "all" })}
                >
                    Show all
                </button>
            ) : null}
        </div>
    );
}
