import { useVirtualizer } from "@tanstack/react-virtual";
import { PencilLine } from "lucide-react";
import { useRef, useState } from "react";

import type { DiffLine, DiffSide, FileDiff, FileStubReason, PendingLineComment } from "#/lib/session/types.ts";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { buildSuggestionComment } from "#/lib/session/suggestion.ts";
import { cn } from "#/lib/utils.ts";

const LINE_HEIGHT = 22;

const STUB_COPY: Record<FileStubReason, { title: string; body: string; canForce: boolean }> = {
    generated: {
        title: "Likely generated",
        body: "Lockfiles and build output are hidden by default so they do not drown the review.",
        canForce: true,
    },
    huge: {
        title: "Large file",
        body: "This blob is over 512 KB. Loading it may slow the tab down.",
        canForce: true,
    },
    binary: {
        title: "Binary file",
        body: "Easy Review cannot show a line diff for this file.",
        canForce: false,
    },
};

export type LineTarget = { path: string; line: number; side: DiffSide; text: string };

export function FileDiffViewer({
    path,
    diff,
    isLoading,
    error,
    pendingComments,
    disabled,
    previewBaseUrl,
    onLoadAnyway,
    onAddComment,
}: {
    path: string;
    diff: FileDiff | null;
    isLoading: boolean;
    error: string | null;
    pendingComments: Array<PendingLineComment>;
    disabled?: boolean;
    previewBaseUrl: string;
    onLoadAnyway: () => void;
    onAddComment: (target: LineTarget, body: string) => Promise<void>;
}) {
    const [compose, setCompose] = useState<LineTarget | null>(null);
    const [draftBody, setDraftBody] = useState("");
    const [suggesting, setSuggesting] = useState(false);
    const [suggestionText, setSuggestionText] = useState("");
    const [saving, setSaving] = useState(false);

    // Coerce — HMR / incomplete targets can leave this undefined and crash the composer.
    const suggestionValue = suggestionText ?? "";
    const noteValue = draftBody ?? "";

    if (error) {
        return <p className="p-4 text-sm text-destructive">{error}</p>;
    }

    if (isLoading && !diff) {
        return <p className="p-4 text-sm text-muted-foreground">Loading {path}…</p>;
    }

    if (diff?.stub) {
        const copy = STUB_COPY[diff.stub];

        return (
            <div className="flex flex-col items-start gap-3 p-6">
                <div>
                    <p className="text-sm font-medium">{copy.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
                </div>
                {copy.canForce ? (
                    <Button size="sm" variant="outline" onClick={onLoadAnyway}>
                        Load anyway
                    </Button>
                ) : null}
            </div>
        );
    }

    if (!diff || diff.lines.length === 0) {
        return <p className="p-4 text-sm text-muted-foreground">No textual changes in this file.</p>;
    }

    function resetComposer() {
        setCompose(null);
        setDraftBody("");
        setSuggesting(false);
        setSuggestionText("");
    }

    async function saveComment() {
        if (!compose) {
            return;
        }

        const body = suggesting ? buildSuggestionComment(noteValue, suggestionValue) : noteValue.trim();

        if (!body) {
            return;
        }

        setSaving(true);
        try {
            await onAddComment(compose, body);
            resetComposer();
        } finally {
            setSaving(false);
        }
    }

    const canSuggest = compose?.side === "RIGHT";
    const canSave = suggesting
        ? suggestionValue.length > 0 || noteValue.trim().length > 0
        : noteValue.trim().length > 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {diff.truncated ? (
                <p className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    Showing the first {diff.lines.length} lines of a longer diff.
                </p>
            ) : null}
            <VirtualDiffLines
                lines={diff.lines}
                path={path}
                pendingComments={pendingComments}
                disabled={disabled}
                selected={compose}
                onSelect={(target) => {
                    setCompose({ ...target, text: target.text ?? "" });
                    setDraftBody("");
                    setSuggesting(false);
                    setSuggestionText(target.text ?? "");
                }}
            />
            {compose ? (
                <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                            Add a comment on line {compose.line} ({compose.side === "LEFT" ? "base" : "head"})
                        </p>
                        {canSuggest ? (
                            <HelpTooltip label="Propose a GitHub suggestion the author can apply in one click">
                                <Button
                                    size="sm"
                                    variant={suggesting ? "secondary" : "outline"}
                                    disabled={disabled}
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={() => {
                                        if (suggesting) {
                                            setSuggesting(false);
                                            return;
                                        }
                                        setSuggesting(true);
                                        setSuggestionText(compose.text ?? "");
                                    }}
                                >
                                    <PencilLine className="size-3.5" aria-hidden="true" />
                                    {suggesting ? "Remove suggestion" : "Suggest edit"}
                                </Button>
                            </HelpTooltip>
                        ) : (
                            <p className="text-[10px] text-muted-foreground">
                                Suggest edit is available on the head (right) side.
                            </p>
                        )}
                    </div>
                    <MarkdownComposer
                        value={noteValue}
                        onChange={setDraftBody}
                        disabled={disabled}
                        rows={suggesting ? 2 : 4}
                        placeholder={
                            suggesting ? "Optional note above the suggestion…" : "Add your comment here, be kind"
                        }
                        previewBaseUrl={previewBaseUrl}
                        onSubmitKey={() => void saveComment()}
                        footer={<span>⌘↵ to add</span>}
                    />
                    {suggesting ? (
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Suggested change
                            </span>
                            <Textarea
                                autoFocus
                                rows={Math.min(8, Math.max(2, suggestionValue.split("\n").length + 1))}
                                value={suggestionValue}
                                spellCheck={false}
                                className="bg-background font-mono text-xs"
                                onChange={(event) => setSuggestionText(event.target.value)}
                                onKeyDown={(event) => {
                                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                        event.preventDefault();
                                        void saveComment();
                                    }
                                }}
                            />
                        </label>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={resetComposer}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            disabled={saving || !canSave || disabled}
                            className="bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                            onClick={() => void saveComment()}
                        >
                            {saving ? "Adding…" : suggesting ? "Add suggestion" : "Add review comment"}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function targetForLine(path: string, line: DiffLine): LineTarget | null {
    if (line.kind === "hunk") {
        return null;
    }

    const text = line.text ?? "";

    if (line.kind === "del" && line.oldNumber !== null) {
        return { path, line: line.oldNumber, side: "LEFT", text };
    }

    if (line.newNumber !== null) {
        return { path, line: line.newNumber, side: "RIGHT", text };
    }

    if (line.oldNumber !== null) {
        return { path, line: line.oldNumber, side: "LEFT", text };
    }

    return null;
}

function VirtualDiffLines({
    lines,
    path,
    pendingComments,
    disabled,
    selected,
    onSelect,
}: {
    lines: Array<DiffLine>;
    path: string;
    pendingComments: Array<PendingLineComment>;
    disabled?: boolean;
    selected: LineTarget | null;
    onSelect: (target: LineTarget) => void;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: lines.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => LINE_HEIGHT,
        overscan: 24,
    });

    const pendingByLine = new Set(
        pendingComments.filter((comment) => comment.path === path).map((comment) => `${comment.side}:${comment.line}`),
    );

    return (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-[22px]">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                    const line = lines[item.index]!;
                    const target = targetForLine(path, line);
                    const isSelected =
                        selected &&
                        target &&
                        selected.line === target.line &&
                        selected.side === target.side &&
                        selected.path === target.path;
                    const hasPending = target ? pendingByLine.has(`${target.side}:${target.line}`) : false;

                    return (
                        <div
                            key={item.key}
                            className={cn(
                                "absolute top-0 left-0 grid w-full grid-cols-[3.5rem_3.5rem_minmax(0,1fr)]",
                                lineClass(line),
                                target
                                    ? disabled
                                        ? "cursor-not-allowed"
                                        : "cursor-pointer hover:brightness-95 dark:hover:brightness-110"
                                    : undefined,
                                isSelected && "ring-1 ring-inset ring-sky-500",
                                hasPending && "outline outline-1 outline-offset-[-1px] outline-amber-500/60",
                            )}
                            style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                            onClick={() => {
                                if (target && !disabled) {
                                    onSelect(target);
                                }
                            }}
                        >
                            <span className="select-none px-2 text-right text-muted-foreground/70 tabular-nums">
                                {line.oldNumber ?? ""}
                            </span>
                            <span className="select-none px-2 text-right text-muted-foreground/70 tabular-nums">
                                {line.newNumber ?? ""}
                            </span>
                            <span className="overflow-x-auto whitespace-pre px-2">
                                {prefix(line)}
                                {line.text}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function prefix(line: DiffLine): string {
    switch (line.kind) {
        case "add":
            return "+";
        case "del":
            return "-";
        case "hunk":
            return "";
        default:
            return " ";
    }
}

function lineClass(line: DiffLine): string {
    switch (line.kind) {
        case "add":
            return "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100";
        case "del":
            return "bg-red-500/10 text-red-900 dark:text-red-100";
        case "hunk":
            return "bg-sky-500/10 font-sans text-[11px] text-sky-800 dark:text-sky-200";
        default:
            return "text-foreground";
    }
}
