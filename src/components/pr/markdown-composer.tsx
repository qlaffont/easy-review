import {
    Bold,
    Code,
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
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Markdown } from "#/components/pr/markdown.tsx";
import { Button } from "#/components/ui/button.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { insertBlock, insertLink, prefixLines, wrapSelection, type MarkdownEditResult } from "#/lib/markdown-edit.ts";
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

/** GitHub-style markdown write/preview box with a formatting toolbar. */
export function MarkdownComposer({
    value,
    onChange,
    placeholder,
    disabled,
    previewBaseUrl,
    rows = 4,
    className,
    footer,
    onSubmitKey,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    previewBaseUrl: string;
    rows?: number;
    className?: string;
    footer?: ReactNode;
    onSubmitKey?: () => void;
}) {
    const [tab, setTab] = useState<"write" | "preview">("write");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pendingSelection = useRef<{ start: number; end: number } | null>(null);

    useEffect(() => {
        const pending = pendingSelection.current;
        const node = textareaRef.current;
        if (!pending || !node) {
            return;
        }
        pendingSelection.current = null;
        node.focus();
        node.setSelectionRange(pending.start, pending.end);
    }, [value]);

    function apply(tool: Tool) {
        const node = textareaRef.current;
        const start = node?.selectionStart ?? value.length;
        const end = node?.selectionEnd ?? value.length;
        const next = tool.run(value, start, end);
        pendingSelection.current = { start: next.selectionStart, end: next.selectionEnd };
        onChange(next.value);
        setTab("write");
    }

    return (
        <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
            <Tabs value={tab} onValueChange={(next) => setTab(next as "write" | "preview")}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-2">
                    <TabsList className="h-auto bg-transparent p-0">
                        <TabsTrigger
                            value="write"
                            className="rounded-none rounded-t-md border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-[#fd8c73] data-[state=active]:bg-background data-[state=active]:shadow-none"
                        >
                            Write
                        </TabsTrigger>
                        <TabsTrigger
                            value="preview"
                            className="rounded-none rounded-t-md border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-[#fd8c73] data-[state=active]:bg-background data-[state=active]:shadow-none"
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
                            {TOOLS.map((tool) => {
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
                                            className="size-7 text-muted-foreground [&_svg]:size-3.5"
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

                <TabsContent value="write" className="mt-0">
                    <Textarea
                        ref={textareaRef}
                        value={value}
                        disabled={disabled}
                        rows={rows}
                        placeholder={placeholder}
                        className="min-h-24 resize-y rounded-none border-0 shadow-none focus-visible:ring-0"
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={(event) => {
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
                        }}
                    />
                </TabsContent>
                <TabsContent value="preview" className="mt-0 min-h-24 p-3">
                    {value.trim() ? (
                        <Markdown source={value} baseUrl={previewBaseUrl} />
                    ) : (
                        <p className="text-sm text-muted-foreground">Nothing to preview</p>
                    )}
                </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <span className="rounded border px-1 py-px font-mono text-[10px] leading-none" aria-hidden="true">
                        M↓
                    </span>
                    <span>Markdown is supported</span>
                </span>
                {footer ? <div className="ml-auto">{footer}</div> : null}
            </div>
        </div>
    );
}
