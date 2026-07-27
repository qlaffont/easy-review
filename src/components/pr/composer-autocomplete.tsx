import {
    AlertTriangle,
    AtSign,
    ChevronsDownUp,
    Code2,
    Command as CommandIcon,
    Info,
    Lightbulb,
    ListTodo,
    type LucideIcon,
    Meh,
    PencilLine,
    Quote,
    Smile,
    Table,
} from "lucide-react";
import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { SlashCommand } from "#/lib/composer-commands.ts";

import { cn } from "#/lib/utils.ts";

export type MentionCandidate = {
    login: string;
    name?: string | null;
    avatarUrl?: string | null;
};

const SLASH_ICONS: Record<string, LucideIcon> = {
    code: Code2,
    suggestion: PencilLine,
    details: ChevronsDownUp,
    table: Table,
    task: ListTodo,
    quote: Quote,
    note: Info,
    warning: AlertTriangle,
    tip: Lightbulb,
    shrug: Meh,
    tableflip: Smile,
};

type FixedPosition = {
    left: number;
    bottom: number;
    maxHeight: number;
    width: number;
};

function positionAbove(anchor: HTMLElement): FixedPosition {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const maxMenuHeight = 224;
    const spaceAbove = Math.max(80, rect.top - margin);
    const maxHeight = Math.min(maxMenuHeight, spaceAbove);
    const width = Math.min(320, Math.max(208, rect.width));
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);

    return {
        left,
        bottom: window.innerHeight - rect.top + 4,
        maxHeight,
        width,
    };
}

export function ComposerAutocomplete({
    mode,
    slashItems,
    mentionItems,
    activeIndex,
    anchorRef,
    onHover,
    onPickSlash,
    onPickMention,
}: {
    mode: "slash" | "mention";
    slashItems: Array<SlashCommand>;
    mentionItems: Array<MentionCandidate>;
    activeIndex: number;
    anchorRef: RefObject<HTMLElement | null>;
    onHover: (index: number) => void;
    onPickSlash: (command: SlashCommand) => void;
    onPickMention: (user: MentionCandidate) => void;
}) {
    const empty = mode === "slash" ? slashItems.length === 0 : mentionItems.length === 0;
    const [position, setPosition] = useState<FixedPosition | null>(null);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!anchor) {
            return;
        }

        const update = () => setPosition(positionAbove(anchor));
        update();

        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [anchorRef]);

    if (!position || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div
            role="listbox"
            aria-label={mode === "slash" ? "Slash commands" : "Mention suggestions"}
            style={{
                position: "fixed",
                left: position.left,
                bottom: position.bottom,
                width: position.width,
                maxHeight: position.maxHeight,
            }}
            className="z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10"
        >
            <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {mode === "slash" ? (
                    <>
                        <CommandIcon className="size-3" aria-hidden="true" />
                        Slash commands
                    </>
                ) : (
                    <>
                        <AtSign className="size-3" aria-hidden="true" />
                        People
                    </>
                )}
            </div>
            {empty ? (
                <p className="px-3 py-2.5 text-xs text-muted-foreground">No matches</p>
            ) : mode === "slash" ? (
                <ul className="min-h-0 flex-1 overflow-y-auto p-1">
                    {slashItems.map((command, index) => {
                        const active = index === activeIndex;
                        const Icon = SLASH_ICONS[command.id] ?? CommandIcon;
                        return (
                            <li key={command.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
                                    )}
                                    onMouseEnter={() => onHover(index)}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        onPickSlash(command);
                                    }}
                                >
                                    <span
                                        className={cn(
                                            "inline-flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-border/60",
                                            active ? "bg-background/70" : "bg-muted",
                                        )}
                                    >
                                        <Icon className="size-3.5" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="flex items-baseline gap-1.5 leading-tight">
                                            <span className="font-medium">{command.label}</span>
                                            <span
                                                className={cn(
                                                    "font-mono text-[11px]",
                                                    active ? "text-accent-foreground/60" : "text-muted-foreground",
                                                )}
                                            >
                                                {command.slash}
                                            </span>
                                        </span>
                                        <span
                                            className={cn(
                                                "mt-0.5 block truncate text-xs leading-snug",
                                                active ? "text-accent-foreground/70" : "text-muted-foreground",
                                            )}
                                        >
                                            {command.description}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <ul className="min-h-0 flex-1 overflow-y-auto p-1">
                    {mentionItems.map((user, index) => {
                        const active = index === activeIndex;
                        return (
                            <li key={user.login}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
                                    )}
                                    onMouseEnter={() => onHover(index)}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        onPickMention(user);
                                    }}
                                >
                                    {user.avatarUrl ? (
                                        <img
                                            src={user.avatarUrl}
                                            alt=""
                                            className="size-6 shrink-0 rounded-full ring-1 ring-border/60"
                                        />
                                    ) : (
                                        <span
                                            aria-hidden="true"
                                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase ring-1 ring-border/60"
                                        >
                                            {user.login.slice(0, 1)}
                                        </span>
                                    )}
                                    <span className="min-w-0 truncate">
                                        <span className="font-medium">@{user.login}</span>
                                        {user.name ? (
                                            <span
                                                className={cn(
                                                    "mt-0.5 block truncate text-xs",
                                                    active ? "text-accent-foreground/70" : "text-muted-foreground",
                                                )}
                                            >
                                                {user.name}
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>,
        document.body,
    );
}
