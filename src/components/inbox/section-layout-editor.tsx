import { useSelector } from "@tanstack/react-store";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { useState } from "react";

import type { InboxSectionLayoutEntry } from "#/lib/session/inbox-sections.ts";

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
                            onHidden={(hidden) => void session.setSectionHidden(entry.id, hidden)}
                            onMove={(direction) => void session.moveSection(entry.id, direction)}
                        />
                    ))}
                </ul>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => {
                            void session.resetSectionLayout();
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
    return (
        <li className="flex flex-col gap-2 rounded-md border px-3 py-2">
            <div className="flex items-center gap-2">
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
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Show on Inbox
                <Switch checked={!entry.hidden} onCheckedChange={(checked) => onHidden(!checked)} />
            </label>
        </li>
    );
}
