import { useSelector } from "@tanstack/react-store";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Plus, Settings2, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { InboxSectionLayoutEntry, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";

import { SECTION_COLOR_STYLES, SECTION_ICONS, visualForSection } from "#/components/inbox/section-visuals.ts";
import { Button } from "#/components/ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
    SECTION_COLOR_IDS,
    SECTION_ICON_IDS,
    defaultLabelForSection,
    normalizeHexColor,
} from "#/lib/session/inbox-sections.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyError, notifySuccess } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function SectionLayoutEditor() {
    const session = useSession();
    const layout = useSelector(session.state, () => session.getSectionLayout());
    const [open, setOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const visible = layout.filter((entry) => !entry.hidden);
    const removed = layout.filter((entry) => entry.hidden);

    function exportSettings() {
        const payload = JSON.stringify(session.getInboxSettings(), null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "easy-review-inbox-settings.json";
        anchor.click();
        URL.revokeObjectURL(url);
        notifySuccess("Inbox settings exported");
    }

    async function importSettingsFile(file: File) {
        try {
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            await session.importInboxSettings(parsed);
            notifySuccess("Inbox settings imported");
        } catch (cause) {
            notifyError(cause instanceof Error ? cause.message : "Could not import Inbox settings.");
        }
    }

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
                        Remove, rename, reorder, and restyle the triage buckets. Classification rules stay the same.
                        Preferences are saved in this browser — export to move them.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={exportSettings}>
                            <Download className="size-3.5" />
                            Export
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="size-3.5" />
                            Import
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) {
                                    void importSettingsFile(file);
                                }
                            }}
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    disabled={removed.length === 0}
                                >
                                    <Plus className="size-3.5" />
                                    Add section
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-56">
                                {removed.map((entry) => {
                                    const visual = visualForSection(entry.id, entry);
                                    const OptionIcon = visual.icon;
                                    const label = entry.label.trim() || defaultLabelForSection(entry.id);
                                    return (
                                        <DropdownMenuItem
                                            key={entry.id}
                                            className="gap-2"
                                            onSelect={() => {
                                                void session
                                                    .setSectionHidden(entry.id, false)
                                                    .then(() => notifySuccess(`Added "${label}"`));
                                            }}
                                        >
                                            <span
                                                className={cn(
                                                    "grid size-6 place-items-center rounded-md",
                                                    visual.chipClass,
                                                )}
                                            >
                                                <OptionIcon
                                                    className={cn("size-3.5", visual.iconClass)}
                                                    aria-hidden="true"
                                                />
                                            </span>
                                            {label}
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                            void session.resetSectionLayout().then(() => notifySuccess("Sections reset to defaults"));
                        }}
                    >
                        Reset
                    </Button>
                </div>

                {visible.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                        No sections on the Inbox. Add one back above.
                    </p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {visible.map((entry, index) => (
                            <SectionLayoutRow
                                key={entry.id}
                                entry={entry}
                                isFirst={index === 0}
                                isLast={index === visible.length - 1}
                                onLabel={(label) => void session.setSectionLabel(entry.id, label)}
                                onColor={(color) => void session.setSectionColor(entry.id, color)}
                                onCustomColor={(customColor) =>
                                    void session.setSectionCustomColor(entry.id, customColor)
                                }
                                onIcon={(icon) => void session.setSectionIcon(entry.id, icon)}
                                onDefaultExpanded={(defaultExpanded) =>
                                    void session.setSectionDefaultExpanded(entry.id, defaultExpanded)
                                }
                                onRemove={() => {
                                    const label = entry.label.trim() || defaultLabelForSection(entry.id);
                                    void session
                                        .setSectionHidden(entry.id, true)
                                        .then(() => notifySuccess(`Removed "${label}"`));
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
                )}
            </DialogContent>
        </Dialog>
    );
}

function SectionLayoutRow({
    entry,
    isFirst,
    isLast,
    onLabel,
    onColor,
    onCustomColor,
    onIcon,
    onDefaultExpanded,
    onRemove,
    onMove,
}: {
    entry: InboxSectionLayoutEntry;
    isFirst: boolean;
    isLast: boolean;
    onLabel: (label: string) => void;
    onColor: (color: SectionColorId) => void;
    onCustomColor: (customColor: string) => void;
    onIcon: (icon: SectionIconId) => void;
    onDefaultExpanded: (defaultExpanded: boolean) => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
}) {
    const visual = visualForSection(entry.id, entry);
    const Icon = visual.icon;
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [hexDraft, setHexDraft] = useState(entry.customColor ?? "");

    useEffect(() => {
        setHexDraft(entry.customColor ?? "");
    }, [entry.customColor]);

    const usingCustom = Boolean(entry.customColor);

    function commitHex(raw: string) {
        const hex = normalizeHexColor(raw);
        if (!hex) {
            setHexDraft(entry.customColor ?? "");
            return;
        }
        setHexDraft(hex);
        onCustomColor(hex);
    }

    return (
        <li
            className={cn("flex flex-col gap-2 rounded-md border border-l-[3px] px-3 py-2", visual.accentClass)}
            style={visual.tones?.accent}
        >
            <div className="flex items-center gap-2">
                <span
                    className={cn("grid size-7 shrink-0 place-items-center rounded-md", visual.chipClass)}
                    style={visual.tones?.chip}
                >
                    <Icon className={cn("size-3.5", visual.iconClass)} style={visual.tones?.icon} aria-hidden="true" />
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
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${entry.label}`}
                        onClick={onRemove}
                    >
                        <Trash2 />
                    </Button>
                </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
                Expanded by default
                <Switch checked={entry.defaultExpanded} onCheckedChange={onDefaultExpanded} />
            </label>

            <button
                type="button"
                aria-expanded={appearanceOpen}
                className="flex cursor-pointer items-center gap-1.5 self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setAppearanceOpen((open) => !open)}
            >
                <ChevronRight
                    className={cn("size-3.5 transition-transform", appearanceOpen && "rotate-90")}
                    aria-hidden="true"
                />
                Appearance
                {!appearanceOpen ? (
                    <span
                        className={cn(
                            "ml-0.5 size-2.5 rounded-full border border-black/10 dark:border-white/15",
                            !usingCustom && SECTION_COLOR_STYLES[entry.color].swatchClass,
                        )}
                        style={usingCustom ? visual.tones?.swatch : undefined}
                        aria-hidden="true"
                    />
                ) : null}
            </button>

            {appearanceOpen ? (
                <div className="flex flex-col gap-3 pl-4">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <p className="text-[11px] font-medium text-muted-foreground">Color</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <div
                                className="flex flex-wrap gap-1.5"
                                role="radiogroup"
                                aria-label={`Preset color for ${entry.label}`}
                            >
                                {SECTION_COLOR_IDS.map((colorId) => {
                                    const selected = !usingCustom && entry.color === colorId;
                                    return (
                                        <button
                                            key={colorId}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            aria-label={colorId}
                                            className={cn(
                                                "size-5 rounded-full border border-black/10 transition-[box-shadow,transform] dark:border-white/15",
                                                SECTION_COLOR_STYLES[colorId].swatchClass,
                                                selected
                                                    ? "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background"
                                                    : "hover:scale-105",
                                            )}
                                            onClick={() => {
                                                setHexDraft("");
                                                onColor(colorId);
                                            }}
                                        />
                                    );
                                })}
                            </div>

                            <label
                                className={cn(
                                    "relative size-5 shrink-0 cursor-pointer rounded-full border border-black/10 dark:border-white/15",
                                    usingCustom && "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background",
                                )}
                                title="Custom color"
                            >
                                <span
                                    className="block size-full rounded-full"
                                    style={{
                                        background:
                                            entry.customColor ??
                                            "conic-gradient(from 90deg, #f43f5e, #eab308, #22c55e, #0ea5e9, #8b5cf6, #f43f5e)",
                                    }}
                                    aria-hidden="true"
                                />
                                <input
                                    type="color"
                                    aria-label={`Custom color for ${entry.label}`}
                                    value={entry.customColor ?? "#6366f1"}
                                    className="absolute inset-0 cursor-pointer opacity-0"
                                    onChange={(event) => {
                                        const hex = normalizeHexColor(event.target.value);
                                        if (!hex) {
                                            return;
                                        }
                                        setHexDraft(hex);
                                        onCustomColor(hex);
                                    }}
                                />
                            </label>

                            <Input
                                value={hexDraft}
                                placeholder="#hex"
                                aria-label={`Hex color for ${entry.label}`}
                                spellCheck={false}
                                className="h-7 w-24 font-mono text-xs"
                                onChange={(event) => setHexDraft(event.target.value)}
                                onBlur={() => commitHex(hexDraft)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        commitHex(hexDraft);
                                    }
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex items-end justify-between gap-3">
                        <div className="flex shrink-0 flex-col gap-1.5">
                            <p className="text-[11px] font-medium text-muted-foreground">Icon</p>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5"
                                        aria-label={`Icon for ${entry.label}`}
                                    >
                                        <Icon
                                            className={cn("size-3.5", visual.iconClass)}
                                            style={visual.tones?.icon}
                                            aria-hidden="true"
                                        />
                                        <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56 p-2">
                                    <div
                                        className="grid grid-cols-6 gap-1"
                                        role="listbox"
                                        aria-label={`Icon for ${entry.label}`}
                                    >
                                        {SECTION_ICON_IDS.map((iconId) => {
                                            const OptionIcon = SECTION_ICONS[iconId];
                                            const selected = entry.icon === iconId;
                                            return (
                                                <DropdownMenuItem
                                                    key={iconId}
                                                    role="option"
                                                    aria-selected={selected}
                                                    aria-label={iconId}
                                                    className={cn(
                                                        "flex size-8 cursor-pointer items-center justify-center rounded-md p-0",
                                                        selected && cn(visual.chipClass, visual.iconClass),
                                                    )}
                                                    style={
                                                        selected
                                                            ? { ...visual.tones?.chip, ...visual.tones?.icon }
                                                            : undefined
                                                    }
                                                    onSelect={() => onIcon(iconId)}
                                                >
                                                    <OptionIcon className="size-3.5" aria-hidden="true" />
                                                </DropdownMenuItem>
                                            );
                                        })}
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>
            ) : null}
        </li>
    );
}
