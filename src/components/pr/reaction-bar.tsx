import { SmilePlus } from "lucide-react";
import { useState } from "react";

import type { ReactionContent, ReactionGroup } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

export const REACTION_OPTIONS: Array<{ content: ReactionContent; emoji: string; label: string }> = [
    { content: "+1", emoji: "👍", label: "Thumbs up" },
    { content: "-1", emoji: "👎", label: "Thumbs down" },
    { content: "laugh", emoji: "😄", label: "Laugh" },
    { content: "hooray", emoji: "🎉", label: "Hooray" },
    { content: "confused", emoji: "😕", label: "Confused" },
    { content: "heart", emoji: "❤️", label: "Heart" },
    { content: "rocket", emoji: "🚀", label: "Rocket" },
    { content: "eyes", emoji: "👀", label: "Eyes" },
];

const EMOJI_BY_CONTENT = Object.fromEntries(REACTION_OPTIONS.map((option) => [option.content, option.emoji])) as Record<
    ReactionContent,
    string
>;

export function ReactionBar({
    groups,
    disabled,
    onToggle,
}: {
    groups: Array<ReactionGroup>;
    disabled?: boolean;
    onToggle: (content: ReactionContent) => void;
}) {
    const [open, setOpen] = useState(false);
    const visible = groups.filter((group) => group.count > 0);

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {visible.map((group) => (
                <button
                    key={group.content}
                    type="button"
                    disabled={disabled}
                    aria-pressed={group.viewerHasReacted}
                    aria-label={`${EMOJI_BY_CONTENT[group.content]} ${group.count}${
                        group.viewerHasReacted ? ", including you" : ""
                    }`}
                    className={cn(
                        "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        group.viewerHasReacted
                            ? "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200"
                            : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() => onToggle(group.content)}
                >
                    <span aria-hidden="true">{EMOJI_BY_CONTENT[group.content]}</span>
                    <span>{group.count}</span>
                </button>
            ))}

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={disabled}
                        className="size-7 text-muted-foreground"
                        aria-label="Add reaction"
                    >
                        <SmilePlus className="size-3.5" aria-hidden="true" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-1.5">
                    <div className="flex items-center gap-0.5" role="listbox" aria-label="Reactions">
                        {REACTION_OPTIONS.map((option) => {
                            const active = groups.some(
                                (group) => group.content === option.content && group.viewerHasReacted,
                            );
                            return (
                                <button
                                    key={option.content}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    aria-label={option.label}
                                    title={option.label}
                                    className={cn(
                                        "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-base transition-colors hover:bg-muted",
                                        active && "bg-sky-500/15",
                                    )}
                                    onClick={() => {
                                        onToggle(option.content);
                                        setOpen(false);
                                    }}
                                >
                                    <span aria-hidden="true">{option.emoji}</span>
                                </button>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
