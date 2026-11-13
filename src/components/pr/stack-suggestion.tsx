import { Link } from "@tanstack/react-router";
import { Layers, X } from "lucide-react";
import { useState } from "react";

import type { PullRequestDetail } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import { useStackSuggestion } from "#/lib/query/pull-request-resources.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyAction } from "#/lib/toast.ts";

/**
 * Offers to stack this pull request onto the open one below it — the pull request whose branch
 * this one targets — when GitHub could: a new stack of the two, or on top of the stack it tops.
 */
export function StackSuggestion({
    repository,
    number,
    detail,
}: {
    repository: string;
    number: number;
    detail: PullRequestDetail | null;
}) {
    const session = useSession();
    const { suggestion, dismiss } = useStackSuggestion(repository, number, detail);
    const [pending, setPending] = useState(false);

    if (!suggestion) {
        return null;
    }

    const { below } = suggestion;
    const [owner = "", repo = ""] = repository.split("/");
    const creating = suggestion.kind === "create";

    async function stack() {
        if (!suggestion) {
            return;
        }
        setPending(true);
        try {
            await notifyAction(() => session.stackPullRequest(repository, number, suggestion), {
                loading: creating ? "Creating the stack…" : "Adding to the stack…",
                success: creating ? `Stacked on #${below.number}` : `Added on top of #${below.number}`,
                error: "GitHub could not stack this pull request.",
            });
        } catch {
            // The toast already reports it; the suggestion stays so the user can retry.
        } finally {
            setPending(false);
        }
    }

    return (
        <section
            aria-label="Stack suggestion"
            className="flex flex-col gap-3 rounded-xl border border-dashed bg-card p-3 shadow-xs sm:flex-row sm:items-center"
        >
            <div className="flex min-w-0 flex-1 gap-2">
                <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-medium">
                        {creating ? "Stack this pull request on " : "Add this pull request on top of "}
                        <Link
                            to="/pr/$owner/$repo/$number"
                            params={{ owner, repo, number: String(below.number) }}
                            className="text-foreground underline-offset-2 hover:underline"
                        >
                            #{below.number}
                        </Link>
                        ?
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={below.title}>
                        {below.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {creating ? (
                            <>
                                It is open below this one: its branch <code>{below.headRefName}</code> is this pull
                                request&apos;s base. A GitHub stack reviews and merges them in order.
                            </>
                        ) : (
                            <>
                                It tops a GitHub stack of {below.stack?.size} pull requests, and its branch{" "}
                                <code>{below.headRefName}</code> is this pull request&apos;s base.
                            </>
                        )}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                <Button size="sm" className="h-8" disabled={pending} onClick={() => void stack()}>
                    {creating ? "Create stack" : "Add to stack"}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={pending}
                    aria-label="Dismiss stack suggestion"
                    title="Don't suggest this again"
                    onClick={dismiss}
                >
                    <X className="size-4" aria-hidden="true" />
                </Button>
            </div>
        </section>
    );
}
