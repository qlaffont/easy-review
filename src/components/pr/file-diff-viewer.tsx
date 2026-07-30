import { useHotkey } from "@tanstack/react-hotkeys";
import { useVirtualizer } from "@tanstack/react-virtual";
import { diffWords } from "diff";
import {
    ChevronDown,
    ChevronUp,
    Copy,
    Ellipsis,
    FoldVertical,
    MessageSquare,
    PencilLine,
    Search,
    UnfoldVertical,
    X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { DiffLayout } from "#/lib/diff-preferences.ts";
import type {
    DiffLine,
    DiffSide,
    FileDiff,
    FileStubReason,
    PendingLineComment,
    PullRequestFile,
    ReviewThread,
} from "#/lib/session/types.ts";

import { DiffCodeText } from "#/components/pr/diff-code-text.tsx";
import { InlineDiffComments } from "#/components/pr/inline-diff-comments.tsx";
import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Input } from "#/components/ui/input.tsx";
import { DiffLoadingSkeleton } from "#/components/ui/loading.tsx";
import { tokensForDiffLine, useFileSyntaxHighlight, type FileSyntaxMaps } from "#/hooks/use-file-syntax-highlight.ts";
import { collectDiffSearchMatches, searchHighlightsForCell, type DiffSearchMatch } from "#/lib/diff-file-search.ts";
import { DIFF_EXPAND_CHUNK, expandDiffGap, materializeFileDiff } from "#/lib/session/build-file-diff.ts";
import { buildSuggestionComment, hasSuggestionFence, stripSuggestionFence } from "#/lib/session/suggestion.ts";
import { notifyCopied, notifyError, notifySuccess } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const LINE_HEIGHT = 22;
const COMPACT_LINE_HEIGHT = 18;

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

type SplitRow =
    | { key: string; kind: "hunk"; line: DiffLine; lineIndex: number }
    | { key: string; kind: "gap"; line: DiffLine; lineIndex: number }
    | {
          key: string;
          kind: "pair";
          left: DiffLine | null;
          right: DiffLine | null;
          leftLineIndex: number | null;
          rightLineIndex: number | null;
      };

export function FileDiffViewer({
    path,
    file,
    diff,
    isLoading,
    error,
    pendingComments,
    threads,
    viewerLogin,
    viewerAvatarUrl,
    showInlineComments,
    disabled,
    previewBaseUrl,
    repository,
    number,
    mentionUsers,
    layout,
    hideWhitespace,
    compactLineHeight,
    viewed,
    canApplySuggestions,
    onViewedChange,
    onLoadAnyway,
    onAddComment,
    onAddSingleComment,
    onRemovePending,
    onReplyToThread,
}: {
    path: string;
    file: PullRequestFile | null;
    diff: FileDiff | null;
    isLoading: boolean;
    error: string | null;
    pendingComments: Array<PendingLineComment>;
    threads: Array<ReviewThread>;
    viewerLogin: string | null;
    viewerAvatarUrl: string | null;
    showInlineComments: boolean;
    disabled?: boolean;
    previewBaseUrl: string;
    repository: string;
    number: number;
    canApplySuggestions?: boolean;
    mentionUsers?: Array<{ login: string; name?: string | null; avatarUrl?: string | null }>;
    layout: DiffLayout;
    hideWhitespace: boolean;
    compactLineHeight: boolean;
    viewed: boolean;
    onViewedChange: (viewed: boolean) => void;
    onLoadAnyway: () => void;
    onAddComment: (target: LineTarget, body: string) => Promise<void>;
    onAddSingleComment: (target: LineTarget, body: string) => Promise<void>;
    onRemovePending: (commentId: string) => Promise<void>;
    onReplyToThread: (threadId: string, body: string) => Promise<void>;
}) {
    const [compose, setCompose] = useState<LineTarget | null>(null);
    const [draftBody, setDraftBody] = useState("");
    const [saving, setSaving] = useState<"stage" | "single" | null>(null);
    const [showFullFile, setShowFullFile] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeMatchId, setActiveMatchId] = useState(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [expansions, setExpansions] = useState<
        Record<string, { fromStart?: number; fromEnd?: number; all?: boolean }>
    >({});

    const noteValue = draftBody ?? "";
    const effectiveShowFullFile = showFullFile;

    useEffect(() => {
        setShowFullFile(false);
        setExpansions({});
        setCompose(null);
        setSearchOpen(false);
        setSearchQuery("");
        setActiveMatchId(-1);
    }, [path, hideWhitespace]);

    const rendered = useMemo(() => {
        if (!diff || diff.stub || diff.beforeText === null || diff.afterText === null) {
            return diff;
        }

        return materializeFileDiff(path, diff.beforeText, diff.afterText, {
            ignoreWhitespace: hideWhitespace,
            showFullFile: effectiveShowFullFile,
            expansions: effectiveShowFullFile ? {} : expansions,
        });
    }, [diff, path, hideWhitespace, effectiveShowFullFile, expansions]);

    const searchMatches = useMemo(
        () => (rendered?.lines ? collectDiffSearchMatches(rendered.lines, searchQuery, layout) : []),
        [rendered?.lines, searchQuery, layout],
    );

    useEffect(() => {
        if (searchMatches.length === 0) {
            setActiveMatchId(-1);
            return;
        }
        setActiveMatchId((current) =>
            searchMatches.some((match) => match.id === current) ? current : searchMatches[0]!.id,
        );
    }, [searchMatches]);

    function openSearch() {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }

    function closeSearch() {
        setSearchOpen(false);
        setSearchQuery("");
        setActiveMatchId(-1);
    }

    function stepSearchMatch(direction: 1 | -1) {
        if (searchMatches.length === 0) {
            return;
        }
        const currentIndex = searchMatches.findIndex((match) => match.id === activeMatchId);
        const baseIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = (baseIndex + direction + searchMatches.length) % searchMatches.length;
        setActiveMatchId(searchMatches[nextIndex]!.id);
    }

    useHotkey(
        "Mod+F",
        (event) => {
            event.preventDefault();
            if (searchOpen) {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                return;
            }
            openSearch();
        },
        { ignoreInputs: false },
    );

    useHotkey(
        "Escape",
        () => {
            if (searchOpen) {
                closeSearch();
            }
        },
        { enabled: searchOpen, ignoreInputs: false },
    );

    useHotkey("Enter", () => stepSearchMatch(1), { enabled: searchOpen, ignoreInputs: true });
    useHotkey("Shift+Enter", () => stepSearchMatch(-1), { enabled: searchOpen, ignoreInputs: true });

    const lineHeight = compactLineHeight ? COMPACT_LINE_HEIGHT : LINE_HEIGHT;
    const syntax = useFileSyntaxHighlight(path, diff?.beforeText, diff?.afterText);

    function resetComposer() {
        setCompose(null);
        setDraftBody("");
    }

    async function saveComment(mode: "stage" | "single") {
        if (!compose || saving) {
            return;
        }

        const body = noteValue.trim();
        if (!body) {
            return;
        }

        setSaving(mode);
        try {
            if (mode === "stage") {
                await onAddComment(compose, body);
            } else {
                await onAddSingleComment(compose, body);
            }
            resetComposer();
        } finally {
            setSaving(null);
        }
    }

    const canSuggest = compose?.side === "RIGHT";
    const canSave = noteValue.trim().length > 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-background">
            <FileDiffHeader
                path={path}
                file={file}
                viewed={viewed}
                pendingCount={pendingComments.length}
                onViewedChange={(next) => {
                    onViewedChange(next);
                    if (next) {
                        setShowFullFile(false);
                        setExpansions({});
                    }
                    notifySuccess(next ? "Marked as viewed" : "Marked as unviewed");
                }}
                showFullFile={effectiveShowFullFile}
                onShowFullFile={() => {
                    setShowFullFile(true);
                    setExpansions({});
                    notifySuccess("Showing full file");
                }}
                onCollapseContext={() => {
                    setShowFullFile(false);
                    setExpansions({});
                    notifySuccess("Collapsed file context");
                }}
                onOpenSearch={openSearch}
            />

            {searchOpen ? (
                <FileDiffSearchBar
                    inputRef={searchInputRef}
                    query={searchQuery}
                    matchCount={searchMatches.length}
                    activeMatchIndex={searchMatches.findIndex((match) => match.id === activeMatchId)}
                    onQueryChange={setSearchQuery}
                    onPrevious={() => stepSearchMatch(-1)}
                    onNext={() => stepSearchMatch(1)}
                    onClose={closeSearch}
                />
            ) : null}

            {error ? (
                <p className="p-4 text-sm text-destructive">{error}</p>
            ) : isLoading && !diff ? (
                <DiffLoadingSkeleton path={path} />
            ) : diff?.stub ? (
                <StubPanel stub={diff.stub} onLoadAnyway={onLoadAnyway} />
            ) : !rendered || rendered.lines.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No textual changes in this file.</p>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    {rendered.truncated ? (
                        <p className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                            Showing the first {rendered.lines.length} lines of a longer diff.
                        </p>
                    ) : null}
                    <VirtualDiffLines
                        lines={rendered.lines}
                        path={path}
                        layout={layout}
                        lineHeight={lineHeight}
                        syntax={syntax}
                        pendingComments={pendingComments}
                        threads={threads}
                        viewerLogin={viewerLogin}
                        viewerAvatarUrl={viewerAvatarUrl}
                        showInlineComments={showInlineComments}
                        previewBaseUrl={previewBaseUrl}
                        repository={repository}
                        number={number}
                        canApplySuggestions={canApplySuggestions}
                        mentionUsers={mentionUsers}
                        disabled={disabled}
                        selected={compose}
                        noteValue={noteValue}
                        canSuggest={canSuggest}
                        canSave={canSave}
                        saving={saving}
                        hasPendingReview={pendingComments.length > 0}
                        onNoteChange={setDraftBody}
                        onCancelCompose={resetComposer}
                        onSaveCompose={(mode) => void saveComment(mode)}
                        onSelect={(target) => {
                            setCompose({ ...target, text: target.text ?? "" });
                            setDraftBody("");
                        }}
                        onExpandGap={(gapId, direction) => {
                            if (direction === "full") {
                                setShowFullFile(true);
                                setExpansions({});
                                return;
                            }
                            setShowFullFile(false);
                            setExpansions((current) => expandDiffGap(current, gapId, direction));
                        }}
                        onRemovePending={onRemovePending}
                        onReplyToThread={onReplyToThread}
                        searchMatches={searchMatches}
                        activeMatchId={activeMatchId}
                    />
                </div>
            )}
        </div>
    );
}

function FileDiffHeader({
    path,
    file,
    viewed,
    pendingCount,
    showFullFile,
    onViewedChange,
    onShowFullFile,
    onCollapseContext,
    onOpenSearch,
}: {
    path: string;
    file: PullRequestFile | null;
    viewed: boolean;
    pendingCount: number;
    showFullFile: boolean;
    onViewedChange: (viewed: boolean) => void;
    onShowFullFile: () => void;
    onCollapseContext: () => void;
    onOpenSearch: () => void;
}) {
    return (
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{path}</code>
            <HelpTooltip label="Find in file (⌘F)">
                <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={onOpenSearch}>
                    <Search className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Find in file</span>
                </Button>
            </HelpTooltip>
            <HelpTooltip label="Copy path">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    onClick={() => {
                        void navigator.clipboard.writeText(path).then(
                            () => notifyCopied("path"),
                            () => notifyError("Could not copy path"),
                        );
                    }}
                >
                    <Copy className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Copy path</span>
                </Button>
            </HelpTooltip>
            {file ? (
                <span className="flex items-center gap-1 text-xs tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                    <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                    <DiffStatBars additions={file.additions} deletions={file.deletions} />
                </span>
            ) : null}
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
                <Checkbox checked={viewed} onCheckedChange={(checked) => onViewedChange(checked === true)} />
                Viewed
            </label>
            {pendingCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    {pendingCount}
                </span>
            ) : null}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" className="size-7" aria-label="File options">
                        <Ellipsis className="size-3.5" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {showFullFile ? (
                        <DropdownMenuItem onSelect={onCollapseContext}>
                            <FoldVertical className="size-3.5" aria-hidden="true" />
                            Collapse context
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onSelect={onShowFullFile}>
                            <UnfoldVertical className="size-3.5" aria-hidden="true" />
                            Show full file
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}

function FileDiffSearchBar({
    inputRef,
    query,
    matchCount,
    activeMatchIndex,
    onQueryChange,
    onPrevious,
    onNext,
    onClose,
}: {
    inputRef: RefObject<HTMLInputElement | null>;
    query: string;
    matchCount: number;
    activeMatchIndex: number;
    onQueryChange: (query: string) => void;
    onPrevious: () => void;
    onNext: () => void;
    onClose: () => void;
}) {
    const status =
        query.trim().length === 0 ? "" : matchCount === 0 ? "No matches" : `${activeMatchIndex + 1} of ${matchCount}`;

    return (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Find in file…"
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                aria-label="Find in file"
            />
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{status}</span>
            <HelpTooltip label="Previous match (Shift+Enter)">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    disabled={matchCount === 0}
                    onClick={onPrevious}
                >
                    <ChevronUp className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Previous match</span>
                </Button>
            </HelpTooltip>
            <HelpTooltip label="Next match (Enter)">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    disabled={matchCount === 0}
                    onClick={onNext}
                >
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Next match</span>
                </Button>
            </HelpTooltip>
            <HelpTooltip label="Close (Esc)">
                <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={onClose}>
                    <X className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Close find bar</span>
                </Button>
            </HelpTooltip>
        </div>
    );
}

function DiffStatBars({ additions, deletions }: { additions: number; deletions: number }) {
    const total = additions + deletions;
    if (total === 0) {
        return null;
    }

    const blocks = 5;
    const addBlocks = Math.round((additions / total) * blocks);
    const delBlocks = Math.min(blocks - addBlocks, Math.round((deletions / total) * blocks));

    return (
        <span className="ml-0.5 inline-flex gap-px" aria-hidden="true">
            {Array.from({ length: blocks }, (_, index) => (
                <span
                    key={index}
                    className={cn(
                        "size-1.5 rounded-[1px]",
                        index < addBlocks
                            ? "bg-emerald-500"
                            : index < addBlocks + delBlocks
                              ? "bg-red-500"
                              : "bg-muted-foreground/25",
                    )}
                />
            ))}
        </span>
    );
}

function StubPanel({ stub, onLoadAnyway }: { stub: FileStubReason; onLoadAnyway: () => void }) {
    const copy = STUB_COPY[stub];

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

function LineCommentComposer({
    compose,
    noteValue,
    canSuggest,
    canSave,
    saving,
    hasPendingReview,
    disabled,
    previewBaseUrl,
    repository,
    number,
    mentionUsers,
    viewerLogin,
    viewerAvatarUrl,
    onNoteChange,
    onCancel,
    onSave,
}: {
    compose: LineTarget;
    noteValue: string;
    canSuggest: boolean;
    canSave: boolean;
    saving: "stage" | "single" | null;
    hasPendingReview: boolean;
    disabled?: boolean;
    previewBaseUrl: string;
    repository: string;
    number: number;
    mentionUsers?: Array<{ login: string; name?: string | null; avatarUrl?: string | null }>;
    viewerLogin: string | null;
    viewerAvatarUrl: string | null;
    onNoteChange: (value: string) => void;
    onCancel: () => void;
    onSave: (mode: "stage" | "single") => void;
}) {
    const sideLabel = compose.side === "LEFT" ? "L" : "R";
    const author = viewerLogin ?? "you";
    const busy = saving != null;
    const hasSuggestion = hasSuggestionFence(noteValue);
    const stageLabel = hasPendingReview ? "Add review comment" : "Start a review";

    return (
        <div className="border-y border-amber-200/90 bg-[#fff8c5] px-3 py-2.5 font-sans dark:border-amber-900/50 dark:bg-amber-950">
            <div className="overflow-hidden rounded-md border border-border/80 bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-3 py-2">
                    {viewerAvatarUrl ? (
                        <img src={viewerAvatarUrl} alt="" className="size-6 shrink-0 rounded-full" />
                    ) : (
                        <span
                            aria-hidden="true"
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase"
                        >
                            {author.slice(0, 1)}
                        </span>
                    )}
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        Add a comment on line {sideLabel}
                        {compose.line}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                        {canSuggest ? (
                            <HelpTooltip
                                label={
                                    hasSuggestion
                                        ? "Remove the suggestion block from this comment"
                                        : "Insert a GitHub suggestion the author can apply in one click"
                                }
                            >
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={hasSuggestion ? "secondary" : "ghost"}
                                    disabled={disabled}
                                    className="h-7 gap-1 px-2 text-xs"
                                    onClick={() => {
                                        if (hasSuggestion) {
                                            onNoteChange(stripSuggestionFence(noteValue));
                                            return;
                                        }
                                        onNoteChange(buildSuggestionComment(noteValue, compose.text ?? ""));
                                    }}
                                >
                                    <PencilLine className="size-3.5" aria-hidden="true" />
                                    {hasSuggestion ? "Remove" : "Suggest"}
                                </Button>
                            </HelpTooltip>
                        ) : null}
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="size-7 text-muted-foreground"
                            aria-label="Cancel comment"
                            onClick={onCancel}
                        >
                            <X className="size-3.5" aria-hidden="true" />
                        </Button>
                    </div>
                </header>

                <div className="p-2">
                    <MarkdownComposer
                        compact
                        autoFocus
                        value={noteValue}
                        onChange={onNoteChange}
                        disabled={disabled}
                        rows={hasSuggestion ? 5 : 3}
                        placeholder="Add your comment here, be kind"
                        previewBaseUrl={previewBaseUrl}
                        suggestionOriginal={compose.text ?? ""}
                        suggestionLine={compose.line}
                        repository={repository}
                        mentionUsers={mentionUsers}
                        pullRequestNumber={number}
                        onSubmitKey={() => onSave("stage")}
                        className="shadow-sm"
                        footer={
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    disabled={busy}
                                    onClick={onCancel}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    disabled={busy || !canSave || disabled}
                                    onClick={() => onSave("single")}
                                >
                                    {saving === "single" ? "Commenting…" : "Add single comment"}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={busy || !canSave || disabled}
                                    className="h-7 bg-[#1f883d] text-white hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                                    onClick={() => onSave("stage")}
                                >
                                    {saving === "stage" ? "Adding…" : stageLabel}
                                </Button>
                            </>
                        }
                    />
                </div>
            </div>
        </div>
    );
}

function targetForLine(path: string, line: DiffLine): LineTarget | null {
    if (line.kind === "hunk" || line.kind === "gap") {
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

function unifiedLineTargets(path: string, line: DiffLine): { left: LineTarget | null; right: LineTarget | null } {
    if (line.kind === "hunk" || line.kind === "gap") {
        return { left: null, right: null };
    }

    const text = line.text ?? "";
    const left = line.oldNumber != null ? { path, line: line.oldNumber, side: "LEFT" as const, text } : null;
    const right = line.newNumber != null ? { path, line: line.newNumber, side: "RIGHT" as const, text } : null;
    return { left, right };
}

function lineTargetFromSelection(container: HTMLElement, path: string): { target: LineTarget; rect: DOMRect } | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode) {
        return null;
    }

    const selectedText = selection.toString();
    if (!selectedText.trim()) {
        return null;
    }

    const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement;
    const codeEl = anchor?.closest("[data-diff-code]");
    if (!codeEl || !container.contains(codeEl)) {
        return null;
    }

    const line = Number(codeEl.getAttribute("data-diff-line"));
    const side = codeEl.getAttribute("data-diff-side");
    const codePath = codeEl.getAttribute("data-diff-path");
    if (!codePath || codePath !== path || !Number.isFinite(line) || (side !== "LEFT" && side !== "RIGHT")) {
        return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const clientRects = range.getClientRects();
    const anchorRect = rect.width > 0 || rect.height > 0 ? rect : clientRects.length > 0 ? clientRects[0]! : null;
    if (!anchorRect) {
        return null;
    }

    return {
        target: { path, line, side, text: selectedText },
        rect: anchorRect,
    };
}

function DiffLineNumber({
    number,
    target,
    disabled,
    selected,
    onSelect,
}: {
    number: number | null;
    target: LineTarget | null;
    disabled?: boolean;
    selected: boolean;
    onSelect: (target: LineTarget) => void;
}) {
    if (number == null) {
        return (
            <span className="select-none px-2 text-right text-muted-foreground/70 tabular-nums" aria-hidden="true" />
        );
    }

    const clickable = target != null && !disabled;

    return (
        <span
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={clickable ? "Add comment on this line" : undefined}
            aria-label={clickable ? `Add comment on line ${number}` : undefined}
            className={cn(
                "select-none px-2 text-right text-muted-foreground/70 tabular-nums",
                clickable &&
                    "cursor-pointer hover:bg-sky-500/15 hover:text-sky-800 dark:hover:bg-sky-500/20 dark:hover:text-sky-200",
                selected && "font-medium text-sky-700 dark:text-sky-300",
            )}
            onClick={(event) => {
                event.stopPropagation();
                if (clickable) {
                    onSelect(target);
                }
            }}
            onKeyDown={(event) => {
                if (!clickable) {
                    return;
                }
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(target);
                }
            }}
        >
            {number}
        </span>
    );
}

function DiffCodeCell({
    path,
    target,
    markSearchActive,
    children,
}: {
    path: string;
    target: LineTarget | null;
    markSearchActive?: boolean;
    children: ReactNode;
}) {
    return (
        <span
            {...(target
                ? {
                      "data-diff-code": "",
                      "data-diff-path": path,
                      "data-diff-line": target.line,
                      "data-diff-side": target.side,
                  }
                : {})}
            {...(markSearchActive ? { "data-diff-search-active": "true" } : {})}
            className="select-text overflow-hidden whitespace-pre px-2 text-foreground"
        >
            {children}
        </span>
    );
}

type SelectionPopupState = { target: LineTarget; x: number; y: number };

function DiffSelectionCommentPopup({
    popup,
    onComment,
    onDismiss,
}: {
    popup: SelectionPopupState;
    onComment: (target: LineTarget) => void;
    onDismiss: () => void;
}) {
    if (typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <>
            <button
                type="button"
                aria-label="Dismiss"
                className="fixed inset-0 z-40 cursor-default"
                onMouseDown={onDismiss}
            />
            <div
                className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full pb-1.5"
                style={{ left: popup.x, top: popup.y }}
            >
                <Button
                    type="button"
                    size="sm"
                    className="pointer-events-auto h-7 gap-1.5 shadow-md"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onComment(popup.target)}
                >
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    Comment
                </Button>
            </div>
        </>,
        document.body,
    );
}

function toSplitRows(lines: Array<DiffLine>): Array<SplitRow> {
    const rows: Array<SplitRow> = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index]!;

        if (line.kind === "hunk" || line.kind === "gap") {
            rows.push({ key: `${line.kind}-${index}`, kind: line.kind, line, lineIndex: index });
            index++;
            continue;
        }

        if (line.kind === "context") {
            rows.push({
                key: `ctx-${index}`,
                kind: "pair",
                left: line,
                right: line,
                leftLineIndex: index,
                rightLineIndex: index,
            });
            index++;
            continue;
        }

        const dels: Array<DiffLine> = [];
        const adds: Array<DiffLine> = [];
        const start = index;

        while (index < lines.length && lines[index]!.kind === "del") {
            dels.push(lines[index]!);
            index++;
        }
        const addStart = index;
        while (index < lines.length && lines[index]!.kind === "add") {
            adds.push(lines[index]!);
            index++;
        }

        const count = Math.max(dels.length, adds.length);
        for (let offset = 0; offset < count; offset++) {
            rows.push({
                key: `pair-${start}-${offset}`,
                kind: "pair",
                left: dels[offset] ?? null,
                right: adds[offset] ?? null,
                leftLineIndex: dels[offset] ? start + offset : null,
                rightLineIndex: adds[offset] ? addStart + offset : null,
            });
        }
    }

    return rows;
}

type LineAnnotations = {
    side: DiffSide;
    line: number;
    text: string;
    pending: Array<PendingLineComment>;
    threads: Array<ReviewThread>;
};

type VirtualRow =
    | { key: string; kind: "unified"; line: DiffLine; lineIndex: number }
    | { key: string; kind: "split"; row: SplitRow }
    | { key: string; kind: "notes"; notes: LineAnnotations }
    | { key: string; kind: "compose"; target: LineTarget };

function targetsIncludeCompose(targets: Array<{ side: DiffSide; line: number }>, compose: LineTarget | null): boolean {
    if (!compose) {
        return false;
    }
    return targets.some((target) => target.side === compose.side && target.line === compose.line);
}

function annotationsForTarget(
    path: string,
    side: DiffSide,
    line: number,
    text: string,
    pendingComments: Array<PendingLineComment>,
    threads: Array<ReviewThread>,
): LineAnnotations | null {
    const pending = pendingComments.filter(
        (comment) => comment.path === path && comment.side === side && comment.line === line,
    );
    const matchedThreads = threads.filter(
        (thread) => thread.path === path && thread.side === side && thread.line === line,
    );
    if (pending.length === 0 && matchedThreads.length === 0) {
        return null;
    }
    return { side, line, text, pending, threads: matchedThreads };
}

function annotationsForDiffLine(
    path: string,
    line: DiffLine,
    pendingComments: Array<PendingLineComment>,
    threads: Array<ReviewThread>,
): Array<LineAnnotations> {
    const targets: Array<{ side: DiffSide; line: number }> = [];
    if (line.kind === "add" && line.newNumber !== null) {
        targets.push({ side: "RIGHT", line: line.newNumber });
    } else if (line.kind === "del" && line.oldNumber !== null) {
        targets.push({ side: "LEFT", line: line.oldNumber });
    } else if (line.kind === "context") {
        if (line.oldNumber !== null) {
            targets.push({ side: "LEFT", line: line.oldNumber });
        }
        if (line.newNumber !== null) {
            targets.push({ side: "RIGHT", line: line.newNumber });
        }
    }

    const seen = new Set<string>();
    const result: Array<LineAnnotations> = [];
    for (const target of targets) {
        const key = `${target.side}:${target.line}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const notes = annotationsForTarget(path, target.side, target.line, line.text ?? "", pendingComments, threads);
        if (notes) {
            result.push(notes);
        }
    }
    return result;
}

function buildVirtualRows(
    lines: Array<DiffLine>,
    path: string,
    layout: DiffLayout,
    pendingComments: Array<PendingLineComment>,
    threads: Array<ReviewThread>,
    showInlineComments: boolean,
    compose: LineTarget | null,
): Array<VirtualRow> {
    const rows: Array<VirtualRow> = [];

    if (layout === "split") {
        const splitRows = toSplitRows(lines);
        for (const [index, row] of splitRows.entries()) {
            rows.push({ key: `split-${row.key}`, kind: "split", row });
            if (row.kind !== "pair") {
                continue;
            }
            const targets: Array<{ side: DiffSide; line: number }> = [];
            if (row.left?.oldNumber != null) {
                targets.push({ side: "LEFT", line: row.left.oldNumber });
            }
            if (row.right?.newNumber != null) {
                targets.push({ side: "RIGHT", line: row.right.newNumber });
            }
            const seen = new Set<string>();
            for (const target of targets) {
                const key = `${target.side}:${target.line}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                if (showInlineComments) {
                    const text = target.side === "LEFT" ? (row.left?.text ?? "") : (row.right?.text ?? "");
                    const notes = annotationsForTarget(path, target.side, target.line, text, pendingComments, threads);
                    if (notes) {
                        rows.push({ key: `notes-${index}-${key}`, kind: "notes", notes });
                    }
                }
            }
            if (compose && targetsIncludeCompose(targets, compose)) {
                rows.push({ key: `compose-${compose.side}-${compose.line}`, kind: "compose", target: compose });
            }
        }
        return rows;
    }

    for (const [index, line] of lines.entries()) {
        rows.push({ key: `line-${index}-${line.kind}`, kind: "unified", line, lineIndex: index });
        if (line.kind === "hunk" || line.kind === "gap") {
            continue;
        }
        if (showInlineComments) {
            for (const notes of annotationsForDiffLine(path, line, pendingComments, threads)) {
                rows.push({
                    key: `notes-${index}-${notes.side}-${notes.line}`,
                    kind: "notes",
                    notes,
                });
            }
        }
        const targets: Array<{ side: DiffSide; line: number }> = [];
        if (line.kind === "add" && line.newNumber !== null) {
            targets.push({ side: "RIGHT", line: line.newNumber });
        } else if (line.kind === "del" && line.oldNumber !== null) {
            targets.push({ side: "LEFT", line: line.oldNumber });
        } else if (line.kind === "context") {
            if (line.oldNumber !== null) {
                targets.push({ side: "LEFT", line: line.oldNumber });
            }
            if (line.newNumber !== null) {
                targets.push({ side: "RIGHT", line: line.newNumber });
            }
        }
        if (compose && targetsIncludeCompose(targets, compose)) {
            rows.push({ key: `compose-${compose.side}-${compose.line}`, kind: "compose", target: compose });
        }
    }

    return rows;
}

function maxLineChars(lines: Array<DiffLine>, side?: DiffSide): number {
    let max = 0;
    for (const line of lines) {
        if (line.kind === "hunk" || line.kind === "gap") {
            continue;
        }
        if (side === "LEFT" && line.kind === "add") {
            continue;
        }
        if (side === "RIGHT" && line.kind === "del") {
            continue;
        }
        if (line.text.length > max) {
            max = line.text.length;
        }
    }
    return max;
}

function virtualRowIndexForMatch(virtualRows: ReadonlyArray<VirtualRow>, match: DiffSearchMatch): number {
    for (const [index, row] of virtualRows.entries()) {
        if (row.kind === "unified" && row.lineIndex === match.lineIndex && match.side === "unified") {
            return index;
        }
        if (row.kind !== "split" || row.row.kind !== "pair") {
            continue;
        }
        if (match.side === "both" && row.row.leftLineIndex === match.lineIndex) {
            return index;
        }
        if (match.side === "LEFT" && row.row.leftLineIndex === match.lineIndex) {
            return index;
        }
        if (match.side === "RIGHT" && row.row.rightLineIndex === match.lineIndex) {
            return index;
        }
    }
    return -1;
}

function VirtualDiffLines({
    lines,
    path,
    layout,
    lineHeight,
    syntax,
    pendingComments,
    threads,
    viewerLogin,
    viewerAvatarUrl,
    showInlineComments,
    previewBaseUrl,
    repository,
    number,
    canApplySuggestions,
    mentionUsers,
    disabled,
    selected,
    noteValue,
    canSuggest,
    canSave,
    saving,
    hasPendingReview,
    onNoteChange,
    onCancelCompose,
    onSaveCompose,
    onSelect,
    onExpandGap,
    onRemovePending,
    onReplyToThread,
    searchMatches,
    activeMatchId,
}: {
    lines: Array<DiffLine>;
    path: string;
    layout: DiffLayout;
    lineHeight: number;
    syntax: FileSyntaxMaps;
    pendingComments: Array<PendingLineComment>;
    threads: Array<ReviewThread>;
    viewerLogin: string | null;
    viewerAvatarUrl: string | null;
    showInlineComments: boolean;
    previewBaseUrl: string;
    repository: string;
    number: number;
    canApplySuggestions?: boolean;
    mentionUsers?: Array<{ login: string; name?: string | null; avatarUrl?: string | null }>;
    disabled?: boolean;
    selected: LineTarget | null;
    noteValue: string;
    canSuggest: boolean;
    canSave: boolean;
    saving: "stage" | "single" | null;
    hasPendingReview: boolean;
    onNoteChange: (value: string) => void;
    onCancelCompose: () => void;
    onSaveCompose: (mode: "stage" | "single") => void;
    onSelect: (target: LineTarget) => void;
    onExpandGap: (gapId: string, direction: "up" | "down" | "all" | "full") => void;
    onRemovePending: (commentId: string) => Promise<void>;
    onReplyToThread: (threadId: string, body: string) => Promise<void>;
    searchMatches: ReadonlyArray<DiffSearchMatch>;
    activeMatchId: number;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const splitRootRef = useRef<HTMLDivElement>(null);
    const leftScrollRef = useRef<HTMLDivElement>(null);
    const rightScrollRef = useRef<HTMLDivElement>(null);
    const unifiedScrollRef = useRef<HTMLDivElement>(null);
    const [leftScroll, setLeftScroll] = useState(0);
    const [rightScroll, setRightScroll] = useState(0);
    const [unifiedScroll, setUnifiedScroll] = useState(0);
    const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null);
    /** Left pane share in split layout (0.2–0.8). */
    const [splitLeftRatio, setSplitLeftRatio] = useState(0.5);

    const virtualRows = useMemo(
        () => buildVirtualRows(lines, path, layout, pendingComments, threads, showInlineComments, selected),
        [lines, path, layout, pendingComments, threads, showInlineComments, selected],
    );

    // At least the pane width so short files still fill the editor; grow with long lines for scroll.
    const leftContentWidth = `max(100%, calc(3rem + ${maxLineChars(lines, "LEFT")}ch + 1rem))`;
    const rightContentWidth = `max(100%, calc(3rem + ${maxLineChars(lines, "RIGHT")}ch + 1rem))`;
    const unifiedContentWidth = `max(100%, calc(7rem + ${maxLineChars(lines)}ch + 1rem))`;

    const virtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => {
            const row = virtualRows[index];
            if (!row) {
                return lineHeight;
            }
            if (row.kind === "notes") {
                return 140;
            }
            if (row.kind === "compose") {
                return 280;
            }
            if (row.kind === "unified") {
                return row.line.kind === "gap" ? 34 : lineHeight;
            }
            return row.row.kind === "gap" ? 34 : lineHeight;
        },
        measureElement: (element) => element.getBoundingClientRect().height,
        overscan: 24,
    });

    const pendingByLine = new Set(
        pendingComments.filter((comment) => comment.path === path).map((comment) => `${comment.side}:${comment.line}`),
    );

    useEffect(() => {
        if (activeMatchId < 0 || searchMatches.length === 0) {
            return;
        }
        const match = searchMatches.find((item) => item.id === activeMatchId);
        if (!match) {
            return;
        }
        const rowIndex = virtualRowIndexForMatch(virtualRows, match);
        if (rowIndex < 0) {
            return;
        }
        virtualizer.scrollToIndex(rowIndex, { align: "center" });
        requestAnimationFrame(() => {
            document.querySelector('[data-diff-search-active="true"]')?.scrollIntoView({ block: "nearest" });
        });
    }, [activeMatchId, searchMatches, virtualRows, virtualizer]);

    useEffect(() => {
        if (selected) {
            setSelectionPopup(null);
        }
    }, [selected]);

    useEffect(() => {
        const scroller = parentRef.current;
        if (!scroller || disabled) {
            return;
        }

        const onMouseUp = () => {
            requestAnimationFrame(() => {
                const match = lineTargetFromSelection(scroller, path);
                if (match) {
                    setSelectionPopup({
                        target: match.target,
                        x: match.rect.left + match.rect.width / 2,
                        y: match.rect.top,
                    });
                    return;
                }
                setSelectionPopup(null);
            });
        };

        const onScroll = () => setSelectionPopup(null);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelectionPopup(null);
            }
        };

        scroller.addEventListener("mouseup", onMouseUp);
        scroller.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("keydown", onKeyDown);
        return () => {
            scroller.removeEventListener("mouseup", onMouseUp);
            scroller.removeEventListener("scroll", onScroll);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [path, disabled]);

    useEffect(() => {
        setLeftScroll(0);
        setRightScroll(0);
        setUnifiedScroll(0);
        if (leftScrollRef.current) {
            leftScrollRef.current.scrollLeft = 0;
        }
        if (rightScrollRef.current) {
            rightScrollRef.current.scrollLeft = 0;
        }
        if (unifiedScrollRef.current) {
            unifiedScrollRef.current.scrollLeft = 0;
        }
        parentRef.current?.scrollTo({ top: 0, left: 0 });
        virtualizer.scrollToOffset(0, { align: "start" });
    }, [path, virtualizer]);

    useEffect(() => {
        setLeftScroll(0);
        setRightScroll(0);
        setUnifiedScroll(0);
        if (leftScrollRef.current) {
            leftScrollRef.current.scrollLeft = 0;
        }
        if (rightScrollRef.current) {
            rightScrollRef.current.scrollLeft = 0;
        }
        if (unifiedScrollRef.current) {
            unifiedScrollRef.current.scrollLeft = 0;
        }
    }, [layout, lines]);

    // Horizontal trackpad/shift-wheel over the code area: the row viewport is overflow-x-hidden
    // (virtualized), so scroll must be forwarded to the bottom pane scrollbars.
    useEffect(() => {
        const scroller = parentRef.current;
        if (!scroller) {
            return;
        }

        const onWheel = (event: WheelEvent) => {
            const shiftAsHorizontal = event.shiftKey && event.deltaY !== 0 && event.deltaX === 0;
            if (!shiftAsHorizontal && Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
                return;
            }
            const dx = shiftAsHorizontal ? event.deltaY : event.deltaX;
            if (dx === 0) {
                return;
            }

            let target: HTMLDivElement | null = null;
            if (layout === "split") {
                const root = splitRootRef.current;
                if (!root) {
                    return;
                }
                const rect = root.getBoundingClientRect();
                const dividerX = rect.left + rect.width * splitLeftRatio;
                target = event.clientX < dividerX ? leftScrollRef.current : rightScrollRef.current;
            } else {
                target = unifiedScrollRef.current;
            }
            if (!target || target.scrollWidth <= target.clientWidth + 1) {
                return;
            }

            const max = target.scrollWidth - target.clientWidth;
            const next = Math.min(max, Math.max(0, target.scrollLeft + dx));
            if (next === target.scrollLeft) {
                return;
            }

            event.preventDefault();
            target.scrollLeft = next;
        };

        scroller.addEventListener("wheel", onWheel, { passive: false });
        return () => scroller.removeEventListener("wheel", onWheel);
    }, [layout, splitLeftRatio]);

    useEffect(() => {
        if (!selected) {
            return;
        }
        const index = virtualRows.findIndex((row) => row.kind === "compose");
        if (index >= 0) {
            virtualizer.scrollToIndex(index, { align: "center" });
        }
        // Scroll once when the compose target changes; ignore virtualizer identity churn.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    }, [selected?.side, selected?.line]);

    return (
        <div
            key={`${layout}-${lineHeight}-${lines.length}-${pendingComments.length}-${threads.length}`}
            ref={splitRootRef}
            className="relative flex min-h-0 flex-1 flex-col font-mono text-xs"
            style={{
                lineHeight: `${lineHeight}px`,
                ...(layout === "split" ? { ["--diff-split-left" as string]: `${splitLeftRatio * 100}%` } : null),
            }}
        >
            <div ref={parentRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                {layout === "split" ? (
                    <SplitResizeHandle
                        ratio={splitLeftRatio}
                        onChange={setSplitLeftRatio}
                        containerRef={splitRootRef}
                    />
                ) : null}
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((item) => {
                        const row = virtualRows[item.index]!;
                        const overlaysSplit = row.kind === "notes" || row.kind === "compose";
                        return (
                            <div
                                key={item.key}
                                data-index={item.index}
                                ref={virtualizer.measureElement}
                                className={cn("absolute top-0 left-0 w-full overflow-hidden", overlaysSplit && "z-20")}
                                style={{ transform: `translateY(${item.start}px)` }}
                            >
                                {row.kind === "notes" ? (
                                    <InlineDiffComments
                                        side={row.notes.side}
                                        line={row.notes.line}
                                        lineText={row.notes.text}
                                        pending={row.notes.pending}
                                        threads={row.notes.threads}
                                        viewerLogin={viewerLogin}
                                        viewerAvatarUrl={viewerAvatarUrl}
                                        previewBaseUrl={previewBaseUrl}
                                        repository={repository}
                                        number={number}
                                        canApplySuggestions={canApplySuggestions}
                                        mentionUsers={mentionUsers}
                                        disabled={disabled}
                                        onRemovePending={onRemovePending}
                                        onReply={onReplyToThread}
                                    />
                                ) : row.kind === "compose" ? (
                                    <LineCommentComposer
                                        compose={row.target}
                                        noteValue={noteValue}
                                        canSuggest={canSuggest}
                                        canSave={canSave}
                                        saving={saving}
                                        hasPendingReview={hasPendingReview}
                                        disabled={disabled}
                                        previewBaseUrl={previewBaseUrl}
                                        repository={repository}
                                        number={number}
                                        mentionUsers={mentionUsers}
                                        viewerLogin={viewerLogin}
                                        viewerAvatarUrl={viewerAvatarUrl}
                                        onNoteChange={onNoteChange}
                                        onCancel={onCancelCompose}
                                        onSave={onSaveCompose}
                                    />
                                ) : row.kind === "split" ? (
                                    <SplitRowView
                                        row={row.row}
                                        path={path}
                                        lineHeight={lineHeight}
                                        syntax={syntax}
                                        pendingByLine={pendingByLine}
                                        disabled={disabled}
                                        selected={selected}
                                        leftScroll={leftScroll}
                                        rightScroll={rightScroll}
                                        leftContentWidth={leftContentWidth}
                                        rightContentWidth={rightContentWidth}
                                        searchMatches={searchMatches}
                                        activeMatchId={activeMatchId}
                                        onSelect={onSelect}
                                        onExpandGap={onExpandGap}
                                    />
                                ) : (
                                    <div className="overflow-hidden">
                                        <div
                                            style={{
                                                width: unifiedContentWidth,
                                                transform: `translateX(-${unifiedScroll}px)`,
                                            }}
                                        >
                                            <UnifiedRow
                                                line={row.line}
                                                lineIndex={row.lineIndex}
                                                path={path}
                                                lineHeight={lineHeight}
                                                syntax={syntax}
                                                pendingByLine={pendingByLine}
                                                disabled={disabled}
                                                selected={selected}
                                                searchMatches={searchMatches}
                                                activeMatchId={activeMatchId}
                                                onSelect={onSelect}
                                                onExpandGap={onExpandGap}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {layout === "split" ? (
                <div
                    className="grid shrink-0 border-t bg-muted/20 font-mono text-xs"
                    style={{ gridTemplateColumns: "var(--diff-split-left) minmax(0,1fr)" }}
                >
                    <div
                        ref={leftScrollRef}
                        className="h-3 overflow-x-auto border-r border-border"
                        onScroll={(event) => setLeftScroll(event.currentTarget.scrollLeft)}
                    >
                        <div aria-hidden="true" style={{ width: leftContentWidth, height: 1 }} />
                    </div>
                    <div
                        ref={rightScrollRef}
                        className="h-3 overflow-x-auto"
                        onScroll={(event) => setRightScroll(event.currentTarget.scrollLeft)}
                    >
                        <div aria-hidden="true" style={{ width: rightContentWidth, height: 1 }} />
                    </div>
                </div>
            ) : (
                <div
                    ref={unifiedScrollRef}
                    className="h-3 shrink-0 overflow-x-auto border-t bg-muted/20 font-mono text-xs"
                    onScroll={(event) => setUnifiedScroll(event.currentTarget.scrollLeft)}
                >
                    <div aria-hidden="true" style={{ width: unifiedContentWidth, height: 1 }} />
                </div>
            )}

            {selectionPopup ? (
                <DiffSelectionCommentPopup
                    popup={selectionPopup}
                    onDismiss={() => setSelectionPopup(null)}
                    onComment={(target) => {
                        onSelect(target);
                        setSelectionPopup(null);
                        window.getSelection()?.removeAllRanges();
                    }}
                />
            ) : null}
        </div>
    );
}

const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

function clampSplitRatio(ratio: number): number {
    return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

function SplitResizeHandle({
    ratio,
    onChange,
    containerRef,
}: {
    ratio: number;
    onChange: (ratio: number) => void;
    containerRef: RefObject<HTMLDivElement | null>;
}) {
    const draggingRef = useRef(false);

    function ratioFromClientX(clientX: number): number {
        const root = containerRef.current;
        if (!root) {
            return ratio;
        }
        const rect = root.getBoundingClientRect();
        if (rect.width <= 0) {
            return ratio;
        }
        return clampSplitRatio((clientX - rect.left) / rect.width);
    }

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize diff panes"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={Math.round(SPLIT_RATIO_MIN * 100)}
            aria-valuemax={Math.round(SPLIT_RATIO_MAX * 100)}
            tabIndex={0}
            className="group absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none"
            style={{ left: "var(--diff-split-left)" }}
            onPointerDown={(event) => {
                event.preventDefault();
                draggingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                onChange(ratioFromClientX(event.clientX));
            }}
            onPointerMove={(event) => {
                if (!draggingRef.current) {
                    return;
                }
                onChange(ratioFromClientX(event.clientX));
            }}
            onPointerUp={(event) => {
                draggingRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
            }}
            onPointerCancel={() => {
                draggingRef.current = false;
            }}
            onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    onChange(clampSplitRatio(ratio - 0.02));
                }
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    onChange(clampSplitRatio(ratio + 0.02));
                }
                if (event.key === "Home") {
                    event.preventDefault();
                    onChange(0.5);
                }
            }}
        >
            <div className="mx-auto h-full w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-sky-500 group-focus-visible:w-0.5 group-focus-visible:bg-sky-500 group-active:bg-sky-500" />
        </div>
    );
}

function GapBar({
    line,
    onExpandGap,
}: {
    line: DiffLine;
    onExpandGap: (gapId: string, direction: "up" | "down" | "all" | "full") => void;
}) {
    const gap = line.gap;
    if (!gap) {
        return null;
    }

    const hidden = gap.oldEnd - gap.oldStart + 1;

    return (
        <div className="flex h-full items-center gap-2 bg-sky-500/10 px-2 text-[11px] text-sky-800 dark:text-sky-200">
            {gap.expandDown ? (
                <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-sky-500/30 bg-background/80 px-1.5 py-0.5 hover:bg-background"
                    onClick={() => onExpandGap(gap.id, "down")}
                >
                    <ChevronDown className="size-3" aria-hidden="true" />
                    Expand {Math.min(DIFF_EXPAND_CHUNK, hidden)} lines
                </button>
            ) : null}
            {gap.expandUp ? (
                <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-sky-500/30 bg-background/80 px-1.5 py-0.5 hover:bg-background"
                    onClick={() => onExpandGap(gap.id, "up")}
                >
                    <ChevronUp className="size-3" aria-hidden="true" />
                    Expand previous
                </button>
            ) : null}
            <button
                type="button"
                className="cursor-pointer rounded px-1.5 py-0.5 hover:underline"
                onClick={() => onExpandGap(gap.id, "all")}
            >
                Show all {hidden} lines
            </button>
            <button
                type="button"
                className="ml-auto cursor-pointer rounded px-1.5 py-0.5 hover:underline"
                onClick={() => onExpandGap(gap.id, "full")}
            >
                Full file
            </button>
        </div>
    );
}

function UnifiedRow({
    line,
    lineIndex,
    path,
    lineHeight,
    syntax,
    pendingByLine,
    disabled,
    selected,
    searchMatches,
    activeMatchId,
    onSelect,
    onExpandGap,
}: {
    line: DiffLine;
    lineIndex: number;
    path: string;
    lineHeight: number;
    syntax: FileSyntaxMaps;
    pendingByLine: Set<string>;
    disabled?: boolean;
    selected: LineTarget | null;
    searchMatches: ReadonlyArray<DiffSearchMatch>;
    activeMatchId: number;
    onSelect: (target: LineTarget) => void;
    onExpandGap: (gapId: string, direction: "up" | "down" | "all" | "full") => void;
}) {
    if (line.kind === "gap") {
        return <GapBar line={line} onExpandGap={onExpandGap} />;
    }

    if (line.kind === "hunk") {
        return (
            <div className="flex h-full items-center bg-sky-500/10 px-2 font-sans text-[11px] text-sky-800 dark:text-sky-200">
                <span className="truncate">{line.text}</span>
            </div>
        );
    }

    const target = targetForLine(path, line);
    const { left: leftTarget, right: rightTarget } = unifiedLineTargets(path, line);
    const isLeftSelected =
        selected != null &&
        leftTarget != null &&
        selected.path === leftTarget.path &&
        selected.line === leftTarget.line &&
        selected.side === leftTarget.side;
    const isRightSelected =
        selected != null &&
        rightTarget != null &&
        selected.path === rightTarget.path &&
        selected.line === rightTarget.line &&
        selected.side === rightTarget.side;
    const isRowSelected = isLeftSelected || isRightSelected;
    const hasPending =
        (leftTarget && pendingByLine.has(`${leftTarget.side}:${leftTarget.line}`)) ||
        (rightTarget && pendingByLine.has(`${rightTarget.side}:${rightTarget.line}`));
    const tokens = tokensForDiffLine(syntax, line.kind, line.oldNumber, line.newNumber);
    const wordSide = line.kind === "del" ? "del" : line.kind === "add" ? "add" : undefined;
    const searchHighlights = searchHighlightsForCell(searchMatches, activeMatchId, lineIndex, "unified");
    const markSearchActive = searchHighlights.some((highlight) => highlight.active);

    return (
        <div
            className={cn(
                "grid h-full grid-cols-[3.5rem_3.5rem_minmax(0,1fr)]",
                lineClass(line),
                isRowSelected && "ring-1 ring-inset ring-sky-500",
                hasPending && "outline outline-1 -outline-offset-1 outline-amber-500/60",
            )}
            style={{ minHeight: lineHeight }}
        >
            <DiffLineNumber
                number={line.oldNumber}
                target={leftTarget}
                disabled={disabled}
                selected={isLeftSelected}
                onSelect={onSelect}
            />
            <DiffLineNumber
                number={line.newNumber}
                target={rightTarget}
                disabled={disabled}
                selected={isRightSelected}
                onSelect={onSelect}
            />
            <DiffCodeCell path={path} target={target} markSearchActive={markSearchActive}>
                {prefix(line)}
                <DiffCodeText text={line.text} tokens={tokens} side={wordSide} searchHighlights={searchHighlights} />
            </DiffCodeCell>
        </div>
    );
}

function SplitRowView({
    row,
    path,
    lineHeight,
    syntax,
    pendingByLine,
    disabled,
    selected,
    leftScroll,
    rightScroll,
    leftContentWidth,
    rightContentWidth,
    searchMatches,
    activeMatchId,
    onSelect,
    onExpandGap,
}: {
    row: SplitRow;
    path: string;
    lineHeight: number;
    syntax: FileSyntaxMaps;
    pendingByLine: Set<string>;
    disabled?: boolean;
    selected: LineTarget | null;
    leftScroll: number;
    rightScroll: number;
    leftContentWidth: string;
    rightContentWidth: string;
    searchMatches: ReadonlyArray<DiffSearchMatch>;
    activeMatchId: number;
    onSelect: (target: LineTarget) => void;
    onExpandGap: (gapId: string, direction: "up" | "down" | "all" | "full") => void;
}) {
    if (row.kind === "gap") {
        return <GapBar line={row.line} onExpandGap={onExpandGap} />;
    }

    if (row.kind === "hunk") {
        return (
            <div
                className="grid h-full bg-sky-500/10 font-sans text-[11px] text-sky-800 dark:text-sky-200"
                style={{ gridTemplateColumns: "var(--diff-split-left) minmax(0,1fr)" }}
            >
                <div className="flex items-center overflow-hidden border-r border-sky-500/20 px-2">
                    <span className="truncate">{row.line.text}</span>
                </div>
                <div className="flex items-center overflow-hidden px-2">
                    <span className="truncate">{row.line.text}</span>
                </div>
            </div>
        );
    }

    const left = row.left;
    const right = row.right;
    const leftText = left?.text ?? "";
    const rightText = right?.text ?? "";
    const wordDiff = left?.kind === "del" && right?.kind === "add" ? diffWords(leftText, rightText) : null;

    return (
        <div
            className="grid"
            style={{
                minHeight: lineHeight,
                gridTemplateColumns: "var(--diff-split-left) minmax(0,1fr)",
            }}
        >
            <div className="min-w-0 overflow-hidden border-r border-border">
                <div style={{ width: leftContentWidth, transform: `translateX(-${leftScroll}px)` }}>
                    <SplitCell
                        line={left}
                        lineIndex={row.kind === "pair" ? row.leftLineIndex : null}
                        path={path}
                        side="LEFT"
                        syntax={syntax}
                        wordDiff={wordDiff}
                        pendingByLine={pendingByLine}
                        disabled={disabled}
                        selected={selected}
                        searchMatches={searchMatches}
                        activeMatchId={activeMatchId}
                        onSelect={onSelect}
                    />
                </div>
            </div>
            <div className="min-w-0 overflow-hidden">
                <div style={{ width: rightContentWidth, transform: `translateX(-${rightScroll}px)` }}>
                    <SplitCell
                        line={right}
                        lineIndex={row.kind === "pair" ? row.rightLineIndex : null}
                        path={path}
                        side="RIGHT"
                        syntax={syntax}
                        wordDiff={wordDiff}
                        pendingByLine={pendingByLine}
                        disabled={disabled}
                        selected={selected}
                        searchMatches={searchMatches}
                        activeMatchId={activeMatchId}
                        onSelect={onSelect}
                    />
                </div>
            </div>
        </div>
    );
}

function SplitCell({
    line,
    lineIndex,
    path,
    side,
    syntax,
    wordDiff,
    pendingByLine,
    disabled,
    selected,
    searchMatches,
    activeMatchId,
    onSelect,
}: {
    line: DiffLine | null;
    lineIndex: number | null;
    path: string;
    side: DiffSide;
    syntax: FileSyntaxMaps;
    wordDiff: ReturnType<typeof diffWords> | null;
    pendingByLine: Set<string>;
    disabled?: boolean;
    selected: LineTarget | null;
    searchMatches: ReadonlyArray<DiffSearchMatch>;
    activeMatchId: number;
    onSelect: (target: LineTarget) => void;
}) {
    if (!line) {
        return <div className="h-full min-h-[inherit] bg-muted/20" />;
    }

    const target =
        line.kind === "context"
            ? {
                  path,
                  line: side === "LEFT" ? (line.oldNumber as number) : (line.newNumber as number),
                  side,
                  text: line.text,
              }
            : targetForLine(path, line);
    const usableTarget =
        target &&
        (side === "LEFT"
            ? target.side === "LEFT" || line.kind === "context"
            : target.side === "RIGHT" || line.kind === "context")
            ? {
                  ...target,
                  side,
                  line: side === "LEFT" ? (line.oldNumber ?? target.line) : (line.newNumber ?? target.line),
              }
            : null;

    const isSelected =
        selected &&
        usableTarget &&
        selected.line === usableTarget.line &&
        selected.side === usableTarget.side &&
        selected.path === usableTarget.path;
    const hasPending = usableTarget ? pendingByLine.has(`${usableTarget.side}:${usableTarget.line}`) : false;
    const number = side === "LEFT" ? line.oldNumber : line.newNumber;
    const tokens = tokensForDiffLine(syntax, line.kind, line.oldNumber, line.newNumber);
    const wordSide = side === "LEFT" ? "del" : "add";
    const searchHighlights =
        lineIndex === null ? [] : searchHighlightsForCell(searchMatches, activeMatchId, lineIndex, side);
    const markSearchActive = searchHighlights.some((highlight) => highlight.active);

    return (
        <div
            className={cn(
                "grid h-full grid-cols-[3rem_minmax(0,1fr)]",
                lineClass(line),
                isSelected && "ring-1 ring-inset ring-sky-500",
                hasPending && "outline outline-1 -outline-offset-1 outline-amber-500/60",
            )}
        >
            <DiffLineNumber
                number={number}
                target={usableTarget}
                disabled={disabled}
                selected={Boolean(isSelected)}
                onSelect={onSelect}
            />
            <DiffCodeCell path={path} target={usableTarget} markSearchActive={markSearchActive}>
                <DiffCodeText
                    text={line.text}
                    tokens={tokens}
                    wordParts={wordDiff}
                    side={wordDiff ? wordSide : line.kind === "del" ? "del" : line.kind === "add" ? "add" : undefined}
                    searchHighlights={searchHighlights}
                />
            </DiffCodeCell>
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
        case "gap":
            return "";
        default:
            return " ";
    }
}

function lineClass(line: DiffLine): string {
    switch (line.kind) {
        case "add":
            return "bg-emerald-500/10";
        case "del":
            return "bg-red-500/10";
        case "hunk":
        case "gap":
            return "bg-sky-500/10 font-sans text-[11px] text-sky-800 dark:text-sky-200";
        default:
            return "";
    }
}
