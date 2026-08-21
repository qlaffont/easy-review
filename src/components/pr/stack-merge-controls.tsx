import { AlertTriangle, ChevronDown, GitMerge } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { ResolvedPullRequestStack } from "#/lib/session/pull-request-stacks.ts";
import type { MergeMethod, PullRequestDetail } from "#/lib/session/types.ts";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { useDiffPreferences } from "#/lib/diff-preferences.ts";
import { useSession } from "#/lib/session/provider.tsx";
import {
    evaluateStackMerge,
    stackMergeMethodDescription,
    type StackMergeEvaluation,
} from "#/lib/session/stack-merge.ts";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const STACK_MERGE_METHODS: Array<MergeMethod> = ["merge", "squash", "rebase"];

const STACK_MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
    merge: "Create merge commits",
    squash: "Squash and merge",
    rebase: "Rebase and merge",
};

function stackMergeMethodOptions(allowed: Array<MergeMethod>) {
    const allowedSet = new Set(allowed);
    return STACK_MERGE_METHODS.filter((method) => allowedSet.has(method)).map((method) => ({
        value: method,
        label: STACK_MERGE_METHOD_LABEL[method],
        description: stackMergeMethodDescription(method, 0),
    }));
}

function mergeMethodDescription(method: MergeMethod, branchCount: number): string {
    return stackMergeMethodDescription(method, branchCount);
}

export function StackMergeControls({ detail, stack }: { detail: PullRequestDetail; stack: ResolvedPullRequestStack }) {
    const session = useSession();
    const [preferences] = useDiffPreferences();
    const [bypassRules, setBypassRules] = useState(false);
    const [deleteHeadBranch, setDeleteHeadBranch] = useState(preferences.deleteHeadBranchOnMerge);
    const evaluation = useMemo(
        () => evaluateStackMerge(stack, { bypassRules, upToNumber: detail.number }),
        [stack, bypassRules, detail.number],
    );
    const mergeOptions = stackMergeMethodOptions(detail.allowedMergeMethods);
    const [mergeMethod, setMergeMethod] = useState<MergeMethod>(
        () =>
            (detail.defaultMergeMethod && mergeOptions.some((option) => option.value === detail.defaultMergeMethod)
                ? detail.defaultMergeMethod
                : mergeOptions[0]?.value) ?? "squash",
    );
    const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
    const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const canBypass = detail.viewerCanMergeAsAdmin;

    if (detail.state !== "open" || stack.total < 2 || mergeOptions.length === 0) {
        return null;
    }

    const branchCount = evaluation.openCount;
    const activeOption = mergeOptions.find((option) => option.value === mergeMethod) ?? mergeOptions[0]!;
    const mergeDisabled = !evaluation.canMerge || busy;

    async function mergeStack() {
        if (busyRef.current || !evaluation.canMerge) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);

        try {
            await notifyAction(
                async () => {
                    await session.mergePullRequestStack(detail.repository, detail.number, mergeMethod, {
                        bypassRules: canBypass && bypassRules,
                        deleteHeadBranch,
                    });
                },
                {
                    loading: `Merging stack (${branchCount} pull request${branchCount === 1 ? "" : "s"})…`,
                    success: "Stack merged",
                    error: "Could not merge the stack.",
                },
            );
            setMergeDialogOpen(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That action failed.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 border-t pt-3">
            {!evaluation.canMerge && evaluation.blockMessage ? (
                <StackMergeBlockedAlert evaluation={evaluation} message={evaluation.blockMessage} />
            ) : null}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {canBypass ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-red-600 dark:text-red-400">
                    <Checkbox
                        checked={bypassRules}
                        onCheckedChange={(checked) => setBypassRules(checked === true)}
                        disabled={busy}
                    />
                    Merge stack without waiting for requirements (bypass rules)
                </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
                <AlertDialog
                    open={mergeDialogOpen}
                    onOpenChange={(open) => {
                        if (open) {
                            setDeleteHeadBranch(preferences.deleteHeadBranchOnMerge);
                        }
                        setMergeDialogOpen(open);
                    }}
                >
                    <div className="flex">
                        <AlertDialogTrigger asChild>
                            <Button size="sm" className="h-8 rounded-r-none gap-1.5" disabled={mergeDisabled}>
                                <GitMerge className="size-3.5" aria-hidden="true" />
                                Merge stack {branchCount > 0 ? branchCount : evaluation.openCount}
                            </Button>
                        </AlertDialogTrigger>
                        <DropdownMenu
                            open={mergeDisabled ? false : mergeMenuOpen}
                            onOpenChange={(open) => {
                                if (mergeDisabled) {
                                    setMergeMenuOpen(false);
                                    return;
                                }
                                setMergeMenuOpen(open);
                            }}
                        >
                            <DropdownMenuTrigger asChild disabled={mergeDisabled}>
                                <Button
                                    size="sm"
                                    className="h-8 rounded-l-none border-l border-primary-foreground/20 px-2"
                                    disabled={mergeDisabled}
                                    aria-label="Choose stack merge method"
                                >
                                    <ChevronDown className="size-3.5" aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-72">
                                {mergeOptions.map((option) => (
                                    <DropdownMenuItem
                                        key={option.value}
                                        onSelect={() => {
                                            setMergeMethod(option.value);
                                            setMergeMenuOpen(false);
                                        }}
                                    >
                                        <span className="flex flex-col gap-0.5">
                                            <span className="font-medium">{option.label}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {mergeMethodDescription(option.value, branchCount)}
                                            </span>
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Merge stack {branchCount} pull request{branchCount === 1 ? "" : "s"}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {mergeMethodDescription(mergeMethod, branchCount)} GitHub will merge this pull request
                                and every unmerged layer below it.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                                checked={deleteHeadBranch}
                                onCheckedChange={(checked) => setDeleteHeadBranch(checked === true)}
                                disabled={busy}
                            />
                            Delete branches after merge
                        </label>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                            <AlertDialogAction disabled={busy} onClick={() => void mergeStack()}>
                                {activeOption.label}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
}

function StackMergeBlockedAlert({ evaluation, message }: { evaluation: StackMergeEvaluation; message: string }) {
    const blockedDownstack = evaluation.rows.some(
        (row) => row.status.kind === "open-blocked" && row.status.reason === "blocked-downstack",
    );

    return (
        <div
            className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                blockedDownstack
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-100"
                    : "border-destructive/30 bg-destructive/5 text-destructive",
            )}
        >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>{message}</p>
        </div>
    );
}
