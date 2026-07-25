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
import { Input } from "#/components/ui/input.tsx";
import { useSession } from "#/lib/session/provider.tsx";

function splitTokens(value: string): Array<string> {
    return [
        ...new Set(
            value
                .split(/[\s,]+/)
                .map((token) => token.trim())
                .filter(Boolean),
        ),
    ];
}

export function PullRequestControls({ detail }: { detail: PullRequestDetail }) {
    const session = useSession();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [labels, setLabels] = useState(() => detail.labels.map((label) => label.name).join(", "));
    const [assignees, setAssignees] = useState(() => detail.assignees.join(", "));
    const [reviewers, setReviewers] = useState(() => detail.reviewRequests.join(", "));
    const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");

    if (detail.state !== "open") {
        return null;
    }

    async function run(action: () => Promise<void>) {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That action failed.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-sm font-medium">Controls</h2>

            <div className="flex flex-wrap gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            await session.setPullRequestDraft(detail.repository, detail.number, !detail.isDraft);
                        })
                    }
                >
                    {detail.isDraft ? "Ready for review" : "Convert to draft"}
                </Button>

                <ConfirmAction
                    title="Close pull request?"
                    description="The pull request will stay on GitHub as closed. This does not delete the branch."
                    actionLabel="Close"
                    disabled={busy}
                    onConfirm={() =>
                        void run(async () => {
                            await session.closePullRequest(detail.repository, detail.number);
                        })
                    }
                >
                    Close
                </ConfirmAction>

                <div className="flex items-center gap-2">
                    <select
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={mergeMethod}
                        disabled={busy || detail.mergeable === "conflicting"}
                        onChange={(event) => setMergeMethod(event.target.value as MergeMethod)}
                    >
                        <option value="squash">Squash</option>
                        <option value="merge">Merge commit</option>
                        <option value="rebase">Rebase</option>
                    </select>
                    <ConfirmAction
                        title="Merge pull request?"
                        description={`This will ${mergeMethod} ${detail.headRefName} into ${detail.baseRefName}.`}
                        actionLabel="Merge"
                        disabled={busy || detail.mergeable === "conflicting"}
                        onConfirm={() =>
                            void run(async () => {
                                await session.mergePullRequest(detail.repository, detail.number, mergeMethod);
                            })
                        }
                    >
                        Merge
                    </ConfirmAction>
                </div>
            </div>

            <TokenField
                label="Labels"
                value={labels}
                disabled={busy}
                onChange={setLabels}
                onSave={() =>
                    void run(async () => {
                        await session.setPullRequestLabels(detail.repository, detail.number, splitTokens(labels));
                    })
                }
            />
            <TokenField
                label="Assignees"
                value={assignees}
                disabled={busy}
                onChange={setAssignees}
                onSave={() =>
                    void run(async () => {
                        await session.setPullRequestAssignees(detail.repository, detail.number, splitTokens(assignees));
                    })
                }
            />
            <TokenField
                label="Requested reviewers"
                value={reviewers}
                disabled={busy}
                onChange={setReviewers}
                onSave={() =>
                    void run(async () => {
                        await session.setReviewRequests(detail.repository, detail.number, splitTokens(reviewers));
                    })
                }
            />

            {detail.reviewRequests.length > 0 ? (
                <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            await session.reRequestReview(detail.repository, detail.number, detail.reviewRequests);
                        })
                    }
                >
                    Re-request review
                </Button>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </section>
    );
}

function TokenField({
    label,
    value,
    disabled,
    onChange,
    onSave,
}: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
}) {
    return (
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {label}
            <div className="flex gap-2">
                <Input
                    value={value}
                    disabled={disabled}
                    placeholder="comma-separated"
                    onChange={(event) => onChange(event.target.value)}
                />
                <Button size="sm" variant="outline" disabled={disabled} onClick={onSave}>
                    Save
                </Button>
            </div>
        </label>
    );
}

function ConfirmAction({
    title,
    description,
    actionLabel,
    disabled,
    onConfirm,
    children,
}: {
    title: string;
    description: string;
    actionLabel: string;
    disabled?: boolean;
    onConfirm: () => void;
    children: React.ReactNode;
}) {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={disabled}>
                    {children}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>{actionLabel}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
