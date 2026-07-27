import { useState } from "react";

import type { SuggestionChange } from "#/lib/session/apply-suggestion.ts";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { defaultSuggestionCommitMessage } from "#/lib/session/apply-suggestion.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { suggestionBatchId, useSuggestionBatch, type BatchedSuggestion } from "#/lib/suggestion-batch.ts";
import { notifyAction } from "#/lib/toast.ts";

export type SuggestionApplyTarget = {
    repository: string;
    number: number;
    path: string;
    canApply: boolean;
};

function commitMessage(title: string, body: string): string {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedBody) {
        return trimmedTitle;
    }
    return `${trimmedTitle}\n\n${trimmedBody}`;
}

export function SuggestionApplyActions({ change, apply }: { change: SuggestionChange; apply: SuggestionApplyTarget }) {
    const session = useSession();
    const batch = useSuggestionBatch(apply.repository, apply.number);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(() => defaultSuggestionCommitMessage([change.path]));
    const [body, setBody] = useState("");
    const [committing, setCommitting] = useState(false);

    if (!apply.canApply) {
        return null;
    }

    const id = suggestionBatchId(change);
    const batched = batch.isBatched(id);

    async function commitOne() {
        if (committing) {
            return;
        }
        setCommitting(true);
        try {
            await notifyAction(
                () =>
                    session.applySuggestions(apply.repository, apply.number, {
                        message: commitMessage(title, body),
                        changes: [change],
                    }),
                {
                    loading: "Committing suggestion…",
                    success: "Suggestion committed",
                    error: "Could not apply the suggestion.",
                },
            );
            batch.remove(id);
            setOpen(false);
        } finally {
            setCommitting(false);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2">
            <Popover
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (next) {
                        setTitle(defaultSuggestionCommitMessage([change.path]));
                        setBody("");
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        size="sm"
                        className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                    >
                        Apply suggestion
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-3">
                    <div className="flex flex-col gap-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted-foreground">Commit message</span>
                            <Input
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                disabled={committing}
                                autoFocus
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted-foreground">Extended description</span>
                            <Textarea
                                value={body}
                                onChange={(event) => setBody(event.target.value)}
                                placeholder="Add an optional extended description…"
                                disabled={committing}
                                rows={3}
                            />
                        </label>
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                size="sm"
                                className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                disabled={committing || !title.trim()}
                                onClick={() => void commitOne()}
                            >
                                Commit changes
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                    if (batched) {
                        batch.remove(id);
                        return;
                    }
                    const item: BatchedSuggestion = {
                        ...change,
                        id,
                        repository: apply.repository,
                        number: apply.number,
                    };
                    batch.add(item);
                }}
            >
                {batched ? "Remove from batch" : "Add suggestion to batch"}
            </Button>
        </div>
    );
}

export function SuggestionBatchBar({ repository, number }: { repository: string; number: number }) {
    const session = useSession();
    const batch = useSuggestionBatch(repository, number);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [committing, setCommitting] = useState(false);

    if (batch.items.length === 0) {
        return null;
    }

    const paths = [...new Set(batch.items.map((item) => item.path))];

    async function commitBatch() {
        if (committing) {
            return;
        }
        setCommitting(true);
        try {
            await notifyAction(
                () =>
                    session.applySuggestions(repository, number, {
                        message: commitMessage(title, body),
                        changes: batch.items,
                    }),
                {
                    loading: "Committing suggestions…",
                    success: "Suggestions committed",
                    error: "Could not apply the suggestions.",
                },
            );
            batch.clear();
            setOpen(false);
        } finally {
            setCommitting(false);
        }
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3">
            <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg">
                <p className="text-sm">
                    <span className="font-semibold tabular-nums">{batch.items.length}</span>
                    {batch.items.length === 1 ? " suggestion" : " suggestions"} ready to commit
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => batch.clear()}>
                        Clear
                    </Button>
                    <Popover
                        open={open}
                        onOpenChange={(next) => {
                            setOpen(next);
                            if (next) {
                                setTitle(defaultSuggestionCommitMessage(paths));
                                setBody("");
                            }
                        }}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                size="sm"
                                className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                            >
                                Commit suggestions
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-3">
                            <div className="flex flex-col gap-2">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-muted-foreground">Commit message</span>
                                    <Input
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        disabled={committing}
                                        autoFocus
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Extended description
                                    </span>
                                    <Textarea
                                        value={body}
                                        onChange={(event) => setBody(event.target.value)}
                                        placeholder="Add an optional extended description…"
                                        disabled={committing}
                                        rows={3}
                                    />
                                </label>
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                        disabled={committing || !title.trim()}
                                        onClick={() => void commitBatch()}
                                    >
                                        Commit changes
                                    </Button>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </div>
    );
}
