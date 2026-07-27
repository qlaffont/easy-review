import { AlertTriangle, Check, ChevronDown, GitMerge, GitPullRequestDraft, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const MERGE_METHOD_ORDER: Array<MergeMethod> = ["merge", "squash", "rebase"];

function mergeMethodOptions(
    allowed: Array<MergeMethod>,
    commitCount: number,
): Array<{ value: MergeMethod; label: string; description: string }> {
    const commitLabel =
        commitCount === 1 ? "The 1 commit from this branch" : `The ${commitCount} commits from this branch`;

    const catalog: Record<MergeMethod, { label: string; description: string }> = {
        merge: {
            label: "Create a merge commit",
            description: "All commits from this branch will be added to the base branch via a merge commit.",
        },
        squash: {
            label: "Squash and merge",
            description: `${commitLabel} will be combined into one commit in the base branch.`,
        },
        rebase: {
            label: "Rebase and merge",
            description: "All commits from this branch will be rebased and added to the base branch.",
        },
    };

    const allowedSet = new Set(allowed);
    return MERGE_METHOD_ORDER.filter((method) => allowedSet.has(method)).map((method) => ({
        value: method,
        ...catalog[method],
    }));
}

export function PullRequestControls({ detail }: { detail: PullRequestDetail }) {
    const session = useSession();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const mergeOptions = mergeMethodOptions(detail.allowedMergeMethods, detail.commitCount);
    const [mergeMethod, setMergeMethod] = useState<MergeMethod>(
        () => detail.defaultMergeMethod ?? mergeOptions[0]?.value ?? "squash",
    );
    const [mergeMenuOpen, setMergeMenuOpen] = useState(false);

    if (detail.state !== "open") {
        return null;
    }

    async function run(action: () => Promise<void>, messages: { loading: string; success: string; error?: string }) {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await notifyAction(action, messages);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That action failed.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    const mergeBlocked = detail.mergeable === "conflicting" || detail.isDraft || mergeOptions.length === 0;
    const mergeDisabled = busy || mergeBlocked;
    const activeMergeMethod = mergeOptions.some((method) => method.value === mergeMethod)
        ? mergeMethod
        : (mergeOptions[0]?.value ?? mergeMethod);
    const selectedMerge = mergeOptions.find((method) => method.value === activeMergeMethod) ?? mergeOptions[0] ?? null;
    const conflictsUrl = `${detail.url}/conflicts`;
    const mergeButtonClass = mergeBlocked
        ? "bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-100"
        : "bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]";

    return (
        <section className="overflow-hidden rounded-lg border">
            <h2 className="sr-only">Manage</h2>

            {detail.mergeable === "conflicting" ? (
                <StatusRow
                    icon={<AlertTriangle className="size-4" aria-hidden="true" />}
                    iconClassName="bg-muted text-muted-foreground"
                    title="This branch has conflicts that must be resolved"
                    description={`Resolve them before this pull request can land into ${detail.baseRefName}.`}
                    action={
                        <Button size="sm" variant="outline" asChild>
                            <a href={conflictsUrl} target="_blank" rel="noreferrer">
                                Resolve conflicts
                            </a>
                        </Button>
                    }
                />
            ) : null}

            {detail.isDraft ? (
                <StatusRow
                    icon={<GitPullRequestDraft className="size-4" aria-hidden="true" />}
                    iconClassName="bg-muted text-muted-foreground"
                    title="This pull request is still a work in progress"
                    description="Draft pull requests cannot be merged."
                    action={
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                void run(
                                    async () => {
                                        await session.setPullRequestDraft(detail.repository, detail.number, false);
                                    },
                                    {
                                        loading: "Marking ready for review…",
                                        success: "Marked ready for review",
                                        error: "Could not update draft status.",
                                    },
                                )
                            }
                        >
                            Ready for review
                        </Button>
                    }
                />
            ) : null}

            {detail.requiredApprovingReviewCount != null &&
            detail.requiredApprovingReviewCount > 0 &&
            detail.reviewDecision === "review-required" ? (
                <StatusRow
                    icon={<GitMerge className="size-4" aria-hidden="true" />}
                    iconClassName="bg-muted text-muted-foreground"
                    title={`At least ${detail.requiredApprovingReviewCount} approving ${
                        detail.requiredApprovingReviewCount === 1 ? "review is" : "reviews are"
                    } required to merge this pull request.`}
                />
            ) : null}

            {detail.reviewRequests.length > 0 ? (
                <StatusRow
                    icon={<RotateCcw className="size-4" aria-hidden="true" />}
                    iconClassName="bg-muted text-muted-foreground"
                    title="Reviewers have already been requested"
                    description="Ask them again if they need another look."
                    action={
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                void run(
                                    async () => {
                                        await session.reRequestReview(
                                            detail.repository,
                                            detail.number,
                                            detail.reviewRequests,
                                        );
                                    },
                                    {
                                        loading: "Re-requesting review…",
                                        success: "Review re-requested",
                                        error: "Could not re-request review.",
                                    },
                                )
                            }
                        >
                            Re-request review
                        </Button>
                    }
                />
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 bg-muted/20 px-4 py-3">
                <p className="mr-auto text-xs text-muted-foreground">
                    {mergeOptions.length === 0
                        ? "No merge methods are enabled for this repository."
                        : detail.mergeable === "conflicting"
                          ? `Conflicts with ${detail.baseRefName} — resolve them before merging.`
                          : detail.isDraft
                            ? "Draft pull requests cannot be merged."
                            : `Ready to land into ${detail.baseRefName}.`}
                </p>
                {selectedMerge ? (
                    <div className="inline-flex">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    size="sm"
                                    disabled={mergeDisabled}
                                    className={cn(
                                        mergeOptions.length > 1 ? "rounded-r-none" : undefined,
                                        mergeButtonClass,
                                    )}
                                >
                                    {selectedMerge.label}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Merge pull request?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will {activeMergeMethod} {detail.headRefName} into {detail.baseRefName}.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                                        onClick={() =>
                                            void run(
                                                async () => {
                                                    await session.mergePullRequest(
                                                        detail.repository,
                                                        detail.number,
                                                        activeMergeMethod,
                                                    );
                                                },
                                                {
                                                    loading: "Merging pull request…",
                                                    success: "Pull request merged",
                                                    error: "Could not merge the pull request.",
                                                },
                                            )
                                        }
                                    >
                                        {selectedMerge.label}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        {mergeOptions.length > 1 ? (
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
                                        disabled={mergeDisabled}
                                        className={cn(
                                            "rounded-l-none border-l px-2",
                                            mergeBlocked ? "border-border" : "border-white/25",
                                            mergeButtonClass,
                                        )}
                                        aria-label="Select merge method"
                                    >
                                        <ChevronDown className="size-3.5" aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-80">
                                    {mergeOptions.map((method, index) => (
                                        <div key={method.value}>
                                            {index > 0 ? <DropdownMenuSeparator /> : null}
                                            <DropdownMenuItem
                                                className="items-start gap-2 py-2"
                                                onSelect={() => setMergeMethod(method.value)}
                                            >
                                                <Check
                                                    className={cn(
                                                        "mt-0.5 size-3.5 shrink-0",
                                                        activeMergeMethod === method.value
                                                            ? "opacity-100"
                                                            : "opacity-0",
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                <span className="flex min-w-0 flex-col gap-0.5">
                                                    <span className="font-medium">{method.label}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {method.description}
                                                    </span>
                                                </span>
                                            </DropdownMenuItem>
                                        </div>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
                    </div>
                ) : null}
                {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
            </div>
        </section>
    );
}

function StatusRow({
    icon,
    iconClassName,
    title,
    description,
    action,
}: {
    icon: React.ReactNode;
    iconClassName?: string;
    title: string;
    description?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", iconClassName)}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}
