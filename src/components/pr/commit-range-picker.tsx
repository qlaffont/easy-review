import { ChevronDown, GitCommitHorizontal } from "lucide-react";

import type { PullRequestCommit } from "#/lib/session/types.ts";

import { CheckStateIcon } from "#/components/pr/commit-checks-menu.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

/** Full PR diff vs an explicit `base...head` commit range. */
export type CommitRangeValue = { mode: "all" } | { mode: "range"; baseOid: string; headOid: string };

export const COMMIT_RANGE_BASE_VALUE = "__base__";

function shortOid(oid: string): string {
    return oid.slice(0, 7);
}

/**
 * Resolve From/To radio values into a compare range.
 * `from` is exclusive (git A in A...B); `to` is inclusive.
 * From=base + To=last commit → full PR.
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
    const baseOid = fromValue === COMMIT_RANGE_BASE_VALUE ? baseSha : fromValue;
    const headOid = toValue;

    if (!baseOid || !headOid) {
        return { mode: "all" };
    }

    if (fromValue === COMMIT_RANGE_BASE_VALUE && headOid === last.oid) {
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
        return { from: COMMIT_RANGE_BASE_VALUE, to: last?.oid ?? "" };
    }

    const from = range.baseOid === baseSha ? COMMIT_RANGE_BASE_VALUE : range.baseOid;
    return { from, to: range.headOid };
}

/** Index of the exclusive “from” endpoint: -1 = PR base, otherwise a commit index. */
export function fromIndexOf(fromValue: string, commits: ReadonlyArray<PullRequestCommit>): number {
    if (fromValue === COMMIT_RANGE_BASE_VALUE) {
        return -1;
    }
    return commits.findIndex((commit) => commit.oid === fromValue);
}

/** Allowed “to” commits must come after the selected “from”. */
export function toCommitOptions(
    commits: ReadonlyArray<PullRequestCommit>,
    fromValue: string,
): Array<PullRequestCommit> {
    const fromIndex = fromIndexOf(fromValue, commits);
    if (fromIndex < -1) {
        return [...commits];
    }
    return commits.slice(fromIndex + 1);
}

export function commitRangeTriggerLabel(
    range: CommitRangeValue,
    commits: ReadonlyArray<PullRequestCommit>,
    baseSha: string,
): string {
    if (range.mode === "all") {
        return `All ${commits.length} commits`;
    }

    const selected = selectValuesFromRange(range, commits, baseSha);
    const toCommit = commits.find((commit) => commit.oid === selected.to);
    if (!toCommit) {
        return `All ${commits.length} commits`;
    }

    const fromHash =
        selected.from === COMMIT_RANGE_BASE_VALUE
            ? shortOid(baseSha)
            : (commits.find((commit) => commit.oid === selected.from)?.abbreviatedOid ?? shortOid(selected.from));

    return `From: ${fromHash} - To: ${toCommit.abbreviatedOid}`;
}

/** Hover detail for the trigger when a range is selected. */
export function commitRangeTriggerTooltip(
    range: CommitRangeValue,
    commits: ReadonlyArray<PullRequestCommit>,
    baseSha: string,
): string | null {
    if (range.mode === "all") {
        return null;
    }

    const selected = selectValuesFromRange(range, commits, baseSha);
    const toCommit = commits.find((commit) => commit.oid === selected.to);
    if (!toCommit) {
        return null;
    }

    const fromLine =
        selected.from === COMMIT_RANGE_BASE_VALUE
            ? `From: ${shortOid(baseSha)} · Pull request merge base`
            : (() => {
                  const fromCommit = commits.find((commit) => commit.oid === selected.from);
                  if (!fromCommit) {
                      return `From: ${shortOid(selected.from)}`;
                  }
                  const headline = fromCommit.messageHeadline.trim() || "(no message)";
                  return `From: ${fromCommit.abbreviatedOid} · ${headline}`;
              })();

    const toHeadline = toCommit.messageHeadline.trim() || "(no message)";
    return `${fromLine}\nTo: ${toCommit.abbreviatedOid} · ${toHeadline}`;
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
    const fromIndex = fromIndexOf(selected.from, commits);
    const toOptions = toCommitOptions(commits, selected.from);
    const toValue = toOptions.some((commit) => commit.oid === selected.to)
        ? selected.to
        : (toOptions[toOptions.length - 1]?.oid ?? selected.to);
    const isolating = range.mode === "range";
    const label = commitRangeTriggerLabel(range, commits, baseSha);
    const tooltip = commitRangeTriggerTooltip(range, commits, baseSha);

    function emit(fromValue: string, toNext: string) {
        const nextToOptions = toCommitOptions(commits, fromValue);
        const resolvedTo = nextToOptions.some((commit) => commit.oid === toNext)
            ? toNext
            : (nextToOptions[nextToOptions.length - 1]?.oid ?? toNext);
        onChange(rangeFromSelectValues(fromValue, resolvedTo, commits, baseSha));
    }

    const trigger = (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-7 max-w-[18rem] shrink gap-1.5 px-2 text-xs font-normal"
            aria-label={tooltip ?? "Choose commits to show in the diff"}
        >
            <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono tabular-nums">{label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
    );

    return (
        <Popover>
            {tooltip ? (
                <HelpTooltip
                    label={
                        <span className="flex max-w-xs flex-col gap-0.5 whitespace-pre-line text-left font-mono text-[11px]">
                            {tooltip}
                        </span>
                    }
                >
                    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                </HelpTooltip>
            ) : (
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            )}
            <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] gap-0 p-0">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Changes from</p>
                        <p className="text-xs text-muted-foreground">Pick the base and the tip commit.</p>
                    </div>
                    {isolating ? (
                        <button
                            type="button"
                            className="shrink-0 text-xs text-sky-700 hover:underline dark:text-sky-400"
                            onClick={() => onChange({ mode: "all" })}
                        >
                            Show all
                        </button>
                    ) : null}
                </div>

                <div
                    className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] gap-x-1 border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground"
                    aria-hidden="true"
                >
                    <span>Commit</span>
                    <span className="text-center">From</span>
                    <span className="text-center">To</span>
                </div>

                <div className="max-h-72 overflow-y-auto py-1" role="table" aria-label="Commit range">
                    <div
                        role="row"
                        className={cn(
                            "grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] items-center gap-x-1 px-3 py-2",
                            selected.from === COMMIT_RANGE_BASE_VALUE && "bg-sky-500/5",
                        )}
                    >
                        <div className="min-w-0" role="cell">
                            <p className="truncate text-sm font-medium text-foreground">Base ({shortOid(baseSha)})</p>
                            <p className="text-xs text-muted-foreground">Pull request merge base</p>
                        </div>
                        <div className="flex justify-center" role="cell">
                            <input
                                type="radio"
                                name="commit-range-from"
                                className="size-3.5 accent-foreground"
                                checked={selected.from === COMMIT_RANGE_BASE_VALUE}
                                aria-label={`Base ${shortOid(baseSha)} as range start`}
                                onChange={() => emit(COMMIT_RANGE_BASE_VALUE, toValue)}
                            />
                        </div>
                        <div className="flex justify-center" role="cell">
                            <span className="text-xs text-muted-foreground/50" aria-hidden="true">
                                —
                            </span>
                        </div>
                    </div>

                    {commits.map((commit, index) => {
                        const headline = commit.messageHeadline.trim() || "(no message)";
                        const canBeFrom = index < commits.length - 1;
                        const canBeTo = index > fromIndex;
                        const isFrom = selected.from === commit.oid;
                        const isTo = toValue === commit.oid;
                        const inRange =
                            index > fromIndex && index <= commits.findIndex((entry) => entry.oid === toValue);

                        return (
                            <div
                                key={commit.oid}
                                role="row"
                                className={cn(
                                    "grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] items-center gap-x-1 px-3 py-2",
                                    inRange && "bg-sky-500/5",
                                )}
                            >
                                <div className="min-w-0" role="cell">
                                    <p className="truncate text-sm font-medium text-foreground">{headline}</p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                                        <span className="font-mono tabular-nums">{commit.abbreviatedOid}</span>
                                        <span aria-hidden="true">·</span>
                                        <span className="truncate">{commit.authorLogin}</span>
                                        <CheckStateIcon state={commit.checkState} className="size-3.5 shrink-0" />
                                    </p>
                                </div>
                                <div className="flex justify-center" role="cell">
                                    {canBeFrom ? (
                                        <input
                                            type="radio"
                                            name="commit-range-from"
                                            className="size-3.5 accent-foreground"
                                            checked={isFrom}
                                            aria-label={`Start after ${commit.abbreviatedOid}`}
                                            onChange={() => emit(commit.oid, toValue)}
                                        />
                                    ) : (
                                        <span className="text-xs text-muted-foreground/50" aria-hidden="true">
                                            —
                                        </span>
                                    )}
                                </div>
                                <div className="flex justify-center" role="cell">
                                    {canBeTo ? (
                                        <input
                                            type="radio"
                                            name="commit-range-to"
                                            className="size-3.5 accent-foreground"
                                            checked={isTo}
                                            aria-label={`End at ${commit.abbreviatedOid}`}
                                            onChange={() => emit(selected.from, commit.oid)}
                                        />
                                    ) : (
                                        <span className="text-xs text-muted-foreground/50" aria-hidden="true">
                                            —
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
