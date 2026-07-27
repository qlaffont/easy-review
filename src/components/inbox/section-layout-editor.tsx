import { useSelector } from "@tanstack/react-store";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { useState } from "react";

import type { InboxSectionLayoutEntry } from "#/lib/session/inbox-sections.ts";

import { SECTION_VISUALS } from "#/components/inbox/section-visuals.ts";
import { Button } from "#/components/ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { notifySuccess } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function SectionLayoutEditor() {
    const session = useSession();
    const layout = useSelector(session.state, () => session.getSectionLayout());
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Settings2 />
                    Sections
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Inbox sections</DialogTitle>
                    <DialogDescription>
                        Hide, rename, or reorder the triage buckets. Classification rules stay the same.
                    </DialogDescription>
                </DialogHeader>

                <ul className="flex flex-col gap-2">
                    {layout.map((entry, index) => (
                        <SectionLayoutRow
                            key={entry.id}
                            entry={entry}
                            isFirst={index === 0}
                            isLast={index === layout.length - 1}
                            onLabel={(label) => void session.setSectionLabel(entry.id, label)}
                            onHidden={(hidden) => {
                                void session
                                    .setSectionHidden(entry.id, hidden)
                                    .then(() =>
                                        notifySuccess(hidden ? `Hidden "${entry.label}"` : `Showing "${entry.label}"`),
                                    );
                            }}
                            onMove={(direction) => {
                                void session
                                    .moveSection(entry.id, direction)
                                    .then(() =>
                                        notifySuccess(
                                            direction === "up"
                                                ? `Moved "${entry.label}" up`
                                                : `Moved "${entry.label}" down`,
                                        ),
                                    );
                            }}
                        />
                    ))}
                </ul>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => {
                            void session.resetSectionLayout().then(() => notifySuccess("Sections reset to defaults"));
                        }}
                    >
                        Reset to defaults
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SectionLayoutRow({
    entry,
    isFirst,
    isLast,
    onLabel,
    onHidden,
    onMove,
}: {
    entry: InboxSectionLayoutEntry;
    isFirst: boolean;
    isLast: boolean;
    onLabel: (label: string) => void;
    onHidden: (hidden: boolean) => void;
    onMove: (direction: "up" | "down") => void;
}) {
    const visual = SECTION_VISUALS[entry.id];
    const Icon = visual.icon;

    return (
        <li className={cn("flex flex-col gap-2 rounded-md border border-l-[3px] px-3 py-2", visual.accentClass)}>
            <div className="flex items-center gap-2">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", visual.chipClass)}>
                    <Icon className={cn("size-3.5", visual.iconClass)} aria-hidden="true" />
                </span>
                <Input
                    value={entry.label}
                    aria-label={`Name for ${entry.id}`}
                    onChange={(event) => onLabel(event.target.value)}
                />
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isFirst}
                        aria-label={`Move ${entry.label} up`}
                        onClick={() => onMove("up")}
                    >
                        <ArrowUp />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isLast}
                        aria-label={`Move ${entry.label} down`}
                        onClick={() => onMove("down")}
                    >
                        <ArrowDown />
                    </Button>
                </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
                Show on Inbox
                <Switch checked={!entry.hidden} onCheckedChange={(checked) => onHidden(!checked)} />
            </label>
        </li>
    );
}
