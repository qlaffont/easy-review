import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, CircleX, GitPullRequestDraft, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { MergeMethod, PullRequestDetail } from "#/lib/session/types.ts";

import {
    checksStatusLabel,
    isMergeBlockedByRequirements,
    isReviewBlocking,
    mergeFooterHint,
    mergingBlockedDescription,
    reviewRequiredDescription,
} from "#/components/pr/merge-requirements.ts";
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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { useDiffPreferences } from "#/lib/diff-preferences.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction, notifyActionWithInboxPrompt } from "#/lib/toast.ts";
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
    const navigate = useNavigate();
    const [preferences] = useDiffPreferences();
    const threads = useSelector(session.state, () => session.getReviewThreads(detail.repository, detail.number));
    const unresolvedThreads = useMemo(() => threads.items.filter((thread) => !thread.isResolved), [threads.items]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [bypassRules, setBypassRules] = useState(false);
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
            return false;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await notifyAction(action, messages);
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That action failed.");
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function mergePullRequest(method: MergeMethod) {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await notifyActionWithInboxPrompt(
                async () => {
                    await session.mergePullRequest(detail.repository, detail.number, method);
                },
                {
                    loading: "Merging pull request…",
                    success: "Pull request merged",
                    error: "Could not merge the pull request.",
                },
                {
                    returnToInbox: preferences.returnToInboxAfterReviewOrMerge,
                    onGoToInbox: () => {
                        void navigate({ to: "/" });
                    },
                },
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That action failed.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function resolveAllThreads() {
        if (busyRef.current || unresolvedThreads.length === 0) {
            return;
        }

        const count = unresolvedThreads.length;
        await run(
            async () => {
                await Promise.all(
                    unresolvedThreads.map((thread) =>
                        session.setReviewThreadResolved(detail.repository, detail.number, thread.id, true),
                    ),
                );
            },
            {
                loading: "Resolving threads…",
                success: count === 1 ? "Thread resolved" : `Resolved ${count} threads`,
                error: "Could not resolve all threads.",
            },
        );
    }

    const requirementsBlocked = isMergeBlockedByRequirements(detail);
    const conflictBlocked = detail.mergeable === "conflicting";
    const draftBlocked = detail.isDraft;
    const canBypass = detail.viewerCanMergeAsAdmin;
    const mergeBlocked =
        conflictBlocked ||
        draftBlocked ||
        mergeOptions.length === 0 ||
        (requirementsBlocked && !(canBypass && bypassRules));
    const mergeDisabled = busy || mergeBlocked;
    const blockedDescription = mergingBlockedDescription(detail);
    const checksStatus = checksStatusLabel(detail);
    const pendingReviewCount = detail.reviewRequests.length;
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

            {conflictBlocked ? (
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

            {draftBlocked ? (
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

            {isReviewBlocking(detail) ? (
                <StatusRow
                    icon={<CircleX className="size-4" aria-hidden="true" />}
                    iconClassName="bg-red-500/10 text-red-600 dark:text-red-400"
                    title={detail.reviewDecision === "changes-requested" ? "Changes requested" : "Review required"}
                    description={
                        detail.reviewDecision === "changes-requested"
                            ? "Changes have been requested on this pull request."
                            : reviewRequiredDescription(detail)
                    }
                />
            ) : null}

            {isReviewBlocking(detail) && pendingReviewCount > 0 ? (
                <StatusRow
                    icon={<Users className="size-4" aria-hidden="true" />}
                    iconClassName="bg-muted text-muted-foreground"
                    title={`${pendingReviewCount} pending ${pendingReviewCount === 1 ? "review" : "reviews"}`}
                    description="Waiting for requested reviewers to submit their review."
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

            {checksStatus ? (
                <StatusRow
                    icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                    iconClassName={
                        checksStatus.ok
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }
                    title={checksStatus.title}
                />
            ) : null}

            {requirementsBlocked && blockedDescription && !conflictBlocked && !draftBlocked ? (
                <StatusRow
                    icon={<AlertTriangle className="size-4" aria-hidden="true" />}
                    iconClassName="bg-red-500/10 text-red-600 dark:text-red-400"
                    title="Merging is blocked"
                    description={blockedDescription}
                />
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 bg-muted/20 px-4 py-3">
                <p className="mr-auto text-xs text-muted-foreground">
                    {mergeFooterHint(detail, mergeOptions.length, mergeBlocked)}
                </p>
                {canBypass ? (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-red-600 dark:text-red-400">
                        <Checkbox
                            checked={bypassRules}
                            onCheckedChange={(checked) => setBypassRules(checked === true)}
                            disabled={busy || conflictBlocked || draftBlocked}
                        />
                        Merge without waiting for requirements (bypass rules)
                    </label>
                ) : null}
                {unresolvedThreads.length > 0 ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolveAllThreads()}>
                        Resolve all threads
                    </Button>
                ) : null}
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
                                    <AlertDialogTitle>
                                        {canBypass && bypassRules ? "Bypass rules and merge?" : "Merge pull request?"}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {canBypass && bypassRules
                                            ? `This will ${activeMergeMethod} ${detail.headRefName} into ${detail.baseRefName} without waiting for merge requirements.`
                                            : `This will ${activeMergeMethod} ${detail.headRefName} into ${detail.baseRefName}.`}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                                        onClick={() => void mergePullRequest(activeMergeMethod)}
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
