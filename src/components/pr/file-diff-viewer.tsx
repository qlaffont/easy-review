import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type { DiffLine, FileDiff, FileStubReason } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
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

export function FileDiffViewer({
    path,
    diff,
    isLoading,
    error,
    onLoadAnyway,
}: {
    path: string;
    diff: FileDiff | null;
    isLoading: boolean;
    error: string | null;
    onLoadAnyway: () => void;
}) {
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

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {diff.truncated ? (
                <p className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    Showing the first {diff.lines.length} lines of a longer diff.
                </p>
            ) : null}
            <VirtualDiffLines lines={diff.lines} />
        </div>
    );
}

function VirtualDiffLines({ lines }: { lines: Array<DiffLine> }) {
    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: lines.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => LINE_HEIGHT,
        overscan: 24,
    });

    return (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-[22px]">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                    const line = lines[item.index]!;

                    return (
                        <div
                            key={item.key}
                            className={cn(
                                "absolute top-0 left-0 grid w-full grid-cols-[3.5rem_3.5rem_minmax(0,1fr)]",
                                lineClass(line),
                            )}
                            style={{ height: item.size, transform: `translateY(${item.start}px)` }}
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
