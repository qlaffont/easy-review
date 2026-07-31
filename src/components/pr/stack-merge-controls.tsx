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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import {
    evaluateStackMerge,
    stackMergeMethodDescription,
    type StackMergeEvaluation,
} from "#/lib/session/stack-merge.ts";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const STACK_MERGE_METHODS: Array<"merge" | "squash"> = ["merge", "squash"];

const STACK_MERGE_METHOD_LABEL: Record<"merge" | "squash", string> = {
    merge: "Create merge commits",
    squash: "Squash and merge",
};

function stackMergeMethodOptions(allowed: Array<MergeMethod>) {
    const allowedSet = new Set(allowed);
    return STACK_MERGE_METHODS.filter((method) => allowedSet.has(method)).map((method) => ({
        value: method,
        label: STACK_MERGE_METHOD_LABEL[method],
        description: stackMergeMethodDescription(method, 0),
    }));
}

function mergeMethodDescription(method: "merge" | "squash", branchCount: number): string {
    return stackMergeMethodDescription(method, branchCount);
}

export function StackMergeControls({ detail, stack }: { detail: PullRequestDetail; stack: ResolvedPullRequestStack }) {
    const session = useSession();
    const evaluation = useMemo(() => evaluateStackMerge(stack), [stack]);
    const mergeOptions = stackMergeMethodOptions(detail.allowedMergeMethods);
    const [mergeMethod, setMergeMethod] = useState<"merge" | "squash">(
        () =>
            (detail.defaultMergeMethod === "merge" || detail.defaultMergeMethod === "squash"
                ? detail.defaultMergeMethod
                : mergeOptions[0]?.value) ?? "squash",
    );
    const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
    const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);

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
                    await session.mergePullRequestStack(detail.repository, detail.number, mergeMethod);
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

            <div className="flex flex-wrap items-center gap-2">
                <AlertDialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
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
                                {mergeMethodDescription(mergeMethod, branchCount)} Pull requests will merge bottom-up,
                                starting with #{evaluation.mergeOrder[0]?.number}.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
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
                "flex gap-2 rounded-lg border px-3 py-2 text-xs",
                blockedDownstack
                    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200",
            )}
            role="status"
        >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{message}</span>
        </div>
    );
}

export { evaluateStackMerge, stackMergeStatusLabel } from "#/lib/session/stack-merge.ts";
