import { useSelector } from "@tanstack/react-store";
import {
    AtSign,
    Bold,
    Code,
    Command,
    FileText,
    Heading2,
    Italic,
    Link2,
    List,
    ListOrdered,
    ListTodo,
    Minus,
    Quote,
    Strikethrough,
    Table,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { MarkdownEditResult } from "#/lib/markdown-edit.ts";

import { ComposerAutocomplete, type MentionCandidate } from "#/components/pr/composer-autocomplete.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
    applyMention,
    applySlashCommand,
    filterMentionLogins,
    filterSlashCommands,
    getComposerTrigger,
    type ComposerTrigger,
    type SlashCommand,
} from "#/lib/composer-commands.ts";
import { insertBlock, insertLink, prefixLines, wrapSelection } from "#/lib/markdown-edit.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

type Tool = {
    label: string;
    icon: ReactNode;
    shortcut?: string;
    run: (value: string, start: number, end: number) => MarkdownEditResult;
};

const TOOLS: Array<Tool> = [
    {
        label: "Bold",
        icon: <Bold aria-hidden="true" />,
        shortcut: "b",
        run: (value, start, end) => wrapSelection(value, start, end, "**", "**", "bold text"),
    },
    {
        label: "Italic",
        icon: <Italic aria-hidden="true" />,
        shortcut: "i",
        run: (value, start, end) => wrapSelection(value, start, end, "_", "_", "italic text"),
    },
    {
        label: "Strikethrough",
        icon: <Strikethrough aria-hidden="true" />,
        run: (value, start, end) => wrapSelection(value, start, end, "~~", "~~", "text"),
    },
    {
        label: "Heading",
        icon: <Heading2 aria-hidden="true" />,
        run: (value, start, end) => prefixLines(value, start, end, "## "),
    },
    {
        label: "Quote",
        icon: <Quote aria-hidden="true" />,
        run: (value, start, end) => prefixLines(value, start, end, "> "),
    },
    {
        label: "Code",
        icon: <Code aria-hidden="true" />,
        shortcut: "e",
        run: (value, start, end) => {
            const selected = value.slice(start, end);
            if (selected.includes("\n")) {
                return wrapSelection(value, start, end, "```\n", "\n```", "code");
            }
            return wrapSelection(value, start, end, "`", "`", "code");
        },
    },
    {
        label: "Link",
        icon: <Link2 aria-hidden="true" />,
        shortcut: "k",
        run: (value, start, end) => insertLink(value, start, end),
    },
    {
        label: "Bulleted list",
        icon: <List aria-hidden="true" />,
        run: (value, start, end) => prefixLines(value, start, end, "- "),
    },
    {
        label: "Numbered list",
        icon: <ListOrdered aria-hidden="true" />,
        run: (value, start, end) => prefixLines(value, start, end, "1. "),
    },
    {
        label: "Task list",
        icon: <ListTodo aria-hidden="true" />,
        run: (value, start, end) => prefixLines(value, start, end, "- [ ] "),
    },
    {
        label: "Horizontal rule",
        icon: <Minus aria-hidden="true" />,
        run: (value, start, end) => insertBlock(value, start, end, "---"),
    },
    {
        label: "Table",
        icon: <Table aria-hidden="true" />,
        run: (value, start, end) =>
            insertBlock(value, start, end, ["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"].join("\n")),
    },
];

/** GitHub-style markdown write/preview box with a formatting toolbar, `/` commands, and `@` mentions. */
export function MarkdownComposer({
    value,
    onChange,
    placeholder,
    disabled,
    previewBaseUrl,
    suggestionOriginal = null,
    suggestionLine = null,
    rows = 4,
    className,
    footer,
    onSubmitKey,
    repository,
    mentionUsers,
    compact = false,
    autoFocus = false,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    previewBaseUrl: string;
    /** Original line(s) for rendering ` ```suggestion ` preview as a red/green edit. */
    suggestionOriginal?: string | null;
    suggestionLine?: number | null;
    rows?: number;
    className?: string;
    footer?: ReactNode;
    onSubmitKey?: () => void;
    /** When set, loads repository assignees for `@` autocomplete. */
    repository?: string;
    /** Extra mention candidates (PR author, reviewers, …). */
    mentionUsers?: Array<MentionCandidate>;
    /** Tighter chrome for inline line comments. */
    compact?: boolean;
    autoFocus?: boolean;
}) {
    const session = useSession();
    const [tab, setTab] = useState<"write" | "preview">("write");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pendingSelection = useRef<{ start: number; end: number } | null>(null);
    const [caret, setCaret] = useState(0);
    const [activeIndex, setActiveIndex] = useState(0);
    const [menuDismissed, setMenuDismissed] = useState(false);
    const meta = useSelector(session.state, () => (repository ? session.getRepositoryMetadata(repository) : null));

    useEffect(() => {
        if (repository) {
            void session.loadRepositoryMetadata(repository);
        }
    }, [session, repository]);

    useEffect(() => {
        const pending = pendingSelection.current;
        const node = textareaRef.current;
        if (!pending || !node) {
            return;
        }
        pendingSelection.current = null;
        node.focus();
        node.setSelectionRange(pending.start, pending.end);
        setCaret(pending.end);
    }, [value]);

    const trigger = useMemo(() => getComposerTrigger(value, caret), [value, caret]);
    const slashItems = useMemo(() => (trigger?.type === "slash" ? filterSlashCommands(trigger.query) : []), [trigger]);
    const mentionPool = useMemo(() => {
        const fromMeta =
            meta?.users.map((user) => ({
                login: user.login,
                name: user.name,
                avatarUrl: user.avatarUrl,
            })) ?? [];
        const byLogin = new Map<string, MentionCandidate>();
        for (const user of [...(mentionUsers ?? []), ...fromMeta]) {
            const key = user.login.toLowerCase();
            const previous = byLogin.get(key);
            if (!previous) {
                byLogin.set(key, user);
                continue;
            }
            byLogin.set(key, {
                login: previous.login,
                name: previous.name ?? user.name,
                avatarUrl: previous.avatarUrl ?? user.avatarUrl,
            });
        }
        return [...byLogin.values()];
    }, [meta?.users, mentionUsers]);
    const mentionItems = useMemo(
        () => (trigger?.type === "mention" ? filterMentionLogins(mentionPool, trigger.query) : []),
        [trigger, mentionPool],
    );

    const menuOpen = tab === "write" && !disabled && !menuDismissed && trigger !== null;

    useEffect(() => {
        setActiveIndex(0);
        setMenuDismissed(false);
    }, [trigger?.type, trigger?.query, trigger?.start]);

    function applyEdit(next: MarkdownEditResult) {
        pendingSelection.current = { start: next.selectionStart, end: next.selectionEnd };
        onChange(next.value);
        setCaret(next.selectionEnd);
        setTab("write");
    }

    function apply(tool: Tool) {
        const node = textareaRef.current;
        const start = node?.selectionStart ?? value.length;
        const end = node?.selectionEnd ?? value.length;
        applyEdit(tool.run(value, start, end));
    }

    function syncCaret(node: HTMLTextAreaElement | null = textareaRef.current) {
        if (node) {
            setCaret(node.selectionStart);
        }
    }

    function pickSlash(command: SlashCommand, currentTrigger: Extract<ComposerTrigger, { type: "slash" }>) {
        applyEdit(applySlashCommand(value, currentTrigger, command));
    }

    function pickMention(user: MentionCandidate, currentTrigger: Extract<ComposerTrigger, { type: "mention" }>) {
        applyEdit(applyMention(value, currentTrigger, user.login));
    }

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (menuOpen && trigger) {
            const count = trigger.type === "slash" ? slashItems.length : mentionItems.length;

            if (event.key === "ArrowDown" && count > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % count);
                return;
            }
            if (event.key === "ArrowUp" && count > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + count) % count);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setMenuDismissed(true);
                return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && count > 0) {
                event.preventDefault();
                if (trigger.type === "slash") {
                    const command = slashItems[activeIndex];
                    if (command) {
                        pickSlash(command, trigger);
                    }
                } else {
                    const user = mentionItems[activeIndex];
                    if (user) {
                        pickMention(user, trigger);
                    }
                }
                return;
            }
        }

        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmitKey?.();
            return;
        }

        if (!(event.metaKey || event.ctrlKey) || event.altKey) {
            return;
        }

        const key = event.key.toLowerCase();
        const tool = TOOLS.find((entry) => entry.shortcut === key);
        if (!tool) {
            return;
        }

        event.preventDefault();
        apply(tool);
    }

    const toolbarTools = compact
        ? TOOLS.filter((tool) => ["Bold", "Italic", "Code", "Link", "Bulleted list", "Quote"].includes(tool.label))
        : TOOLS;

    return (
        <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
            <Tabs value={tab} onValueChange={(next) => setTab(next as "write" | "preview")}>
                <div
                    className={cn(
                        "flex flex-wrap items-center justify-between gap-1 border-b bg-muted/30 px-2",
                        compact && "gap-0.5",
                    )}
                >
                    <TabsList variant="line" className="h-auto gap-0 bg-transparent p-0">
                        <TabsTrigger
                            value="write"
                            className={cn(
                                "rounded-none border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none after:hidden",
                                "hover:text-foreground",
                                "data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
                                "data-[state=active]:border-b-2 data-[state=active]:border-foreground",
                                compact ? "py-1.5" : "py-2",
                            )}
                        >
                            Write
                        </TabsTrigger>
                        <TabsTrigger
                            value="preview"
                            className={cn(
                                "rounded-none border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none after:hidden",
                                "hover:text-foreground",
                                "data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
                                "data-[state=active]:border-b-2 data-[state=active]:border-foreground",
                                compact ? "py-1.5" : "py-2",
                            )}
                        >
                            Preview
                        </TabsTrigger>
                    </TabsList>

                    {tab === "write" ? (
                        <div
                            className="flex flex-wrap items-center justify-end gap-0.5 py-1"
                            role="toolbar"
                            aria-label="Markdown formatting"
                        >
                            {toolbarTools.map((tool) => {
                                const hint = tool.shortcut
                                    ? `${tool.label} (⌘${tool.shortcut.toUpperCase()})`
                                    : tool.label;

                                return (
                                    <HelpTooltip key={tool.label} label={hint}>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            disabled={disabled}
                                            aria-label={tool.label}
                                            className={cn(
                                                "text-muted-foreground [&_svg]:size-3.5",
                                                compact ? "size-6" : "size-7",
                                            )}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => apply(tool)}
                                        >
                                            {tool.icon}
                                        </Button>
                                    </HelpTooltip>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                <TabsContent value="write" className="relative mt-0">
                    <Textarea
                        ref={textareaRef}
                        value={value}
                        disabled={disabled}
                        rows={rows}
                        autoFocus={autoFocus}
                        placeholder={placeholder ?? "Write a comment… Use @ to mention, / for commands"}
                        className={cn(
                            "resize-y rounded-none border-0 shadow-none focus-visible:ring-0",
                            compact ? "min-h-16 px-3 py-2 text-sm" : "min-h-24",
                        )}
                        onChange={(event) => {
                            onChange(event.target.value);
                            setCaret(event.target.selectionStart);
                        }}
                        onClick={() => syncCaret()}
                        onKeyUp={() => syncCaret()}
                        onSelect={() => syncCaret()}
                        onKeyDown={onKeyDown}
                    />
                    {menuOpen && trigger ? (
                        <ComposerAutocomplete
                            mode={trigger.type}
                            slashItems={slashItems}
                            mentionItems={mentionItems}
                            activeIndex={activeIndex}
                            anchorRef={textareaRef}
                            onHover={setActiveIndex}
                            onPickSlash={(command) => {
                                if (trigger.type === "slash") {
                                    pickSlash(command, trigger);
                                }
                            }}
                            onPickMention={(user) => {
                                if (trigger.type === "mention") {
                                    pickMention(user, trigger);
                                }
                            }}
                        />
                    ) : null}
                </TabsContent>
                <TabsContent value="preview" className={cn("mt-0 p-3", compact ? "min-h-16" : "min-h-24")}>
                    {value.trim() ? (
                        <Markdown
                            source={value}
                            baseUrl={previewBaseUrl}
                            suggestionOriginal={suggestionOriginal}
                            suggestionLine={suggestionLine}
                        />
                    ) : (
                        <p className="text-sm text-muted-foreground">Nothing to preview</p>
                    )}
                </TabsContent>
            </Tabs>

            <div
                className={cn(
                    "flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground",
                    compact ? "bg-background" : "bg-muted/20",
                )}
            >
                {compact ? (
                    <span className="flex items-center gap-2.5 text-[11px]">
                        <span className="inline-flex items-center gap-1">
                            <AtSign className="size-3" aria-hidden="true" />
                            mention
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Command className="size-3" aria-hidden="true" />
                            commands
                        </span>
                        <span className="text-muted-foreground/70">⌘↵</span>
                    </span>
                ) : (
                    <ul className="flex flex-wrap items-center gap-1" aria-label="Composer shortcuts">
                        <li>
                            <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1">
                                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>Markdown</span>
                            </span>
                        </li>
                        <li aria-hidden="true" className="text-border">
                            ·
                        </li>
                        <li>
                            <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1">
                                <AtSign className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>
                                    <kbd className="font-mono text-[11px]">@</kbd> mention
                                </span>
                            </span>
                        </li>
                        <li aria-hidden="true" className="text-border">
                            ·
                        </li>
                        <li>
                            <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1">
                                <Command className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>
                                    <kbd className="font-mono text-[11px]">/</kbd> commands
                                </span>
                            </span>
                        </li>
                    </ul>
                )}
                {footer ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{footer}</div> : null}
            </div>
        </div>
    );
}
