import { useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import type { InboxSectionId, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";

import { SECTION_COLOR_STYLES, SECTION_ICONS, visualForSection } from "#/components/inbox/section-visuals.ts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
    SECTION_COLOR_IDS,
    SECTION_ICON_IDS,
    defaultLabelForSection,
    normalizeHexColor,
} from "#/lib/session/inbox-sections.ts";
import { useSession } from "#/lib/session/provider.tsx";
import { cn } from "#/lib/utils.ts";

export function SectionAppearanceEditor({
    sectionId,
    open,
    onOpenChange,
}: {
    sectionId: InboxSectionId | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const session = useSession();
    const entry = useSelector(session.state, () =>
        sectionId ? (session.getSectionLayout().find((row) => row.id === sectionId) ?? null) : null,
    );
    const [hexDraft, setHexDraft] = useState("");

    useEffect(() => {
        if (open && entry) {
            setHexDraft(entry.customColor ?? "");
        }
    }, [open, entry]);

    if (!sectionId || !entry) {
        return null;
    }

    const sectionEntry = entry;
    const label = sectionEntry.label.trim() || defaultLabelForSection(sectionEntry.id);
    const visual = visualForSection(sectionEntry.id, sectionEntry);
    const Icon = visual.icon;
    const usingCustom = Boolean(sectionEntry.customColor);

    function commitHex(raw: string) {
        const hex = normalizeHexColor(raw);
        if (!hex) {
            setHexDraft(sectionEntry.customColor ?? "");
            return;
        }
        setHexDraft(hex);
        void session.setSectionCustomColor(sectionEntry.id, hex);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="pr-8 text-left">
                    <DialogTitle className="flex items-center gap-2">
                        <span
                            className={cn("grid size-7 place-items-center rounded-md", visual.chipClass)}
                            style={visual.tones?.chip}
                        >
                            <Icon
                                className={cn("size-3.5", visual.iconClass)}
                                style={visual.tones?.icon}
                                aria-hidden="true"
                            />
                        </span>
                        Appearance — {label}
                    </DialogTitle>
                    <DialogDescription>Pick a color and icon for this section on the inbox board.</DialogDescription>
                </DialogHeader>

                <SectionAppearanceControls
                    label={label}
                    color={sectionEntry.color}
                    customColor={sectionEntry.customColor}
                    icon={sectionEntry.icon}
                    hexDraft={hexDraft}
                    usingCustom={usingCustom}
                    onHexDraftChange={setHexDraft}
                    onCommitHex={commitHex}
                    onColor={(color) => void session.setSectionColor(sectionEntry.id, color)}
                    onIcon={(icon) => void session.setSectionIcon(sectionEntry.id, icon)}
                />
            </DialogContent>
        </Dialog>
    );
}

export function SectionAppearanceControls({
    label,
    color,
    customColor,
    icon,
    hexDraft,
    usingCustom,
    onHexDraftChange,
    onCommitHex,
    onColor,
    onIcon,
}: {
    label: string;
    color: SectionColorId;
    customColor: string | null;
    icon: SectionIconId;
    hexDraft: string;
    usingCustom: boolean;
    onHexDraftChange: (value: string) => void;
    onCommitHex: (raw: string) => void;
    onColor: (color: SectionColorId) => void;
    onIcon: (icon: SectionIconId) => void;
}) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Color</span>
                <div className="flex flex-wrap gap-1.5">
                    {SECTION_COLOR_IDS.map((colorId) => {
                        const swatch = SECTION_COLOR_STYLES[colorId];
                        const selected = !usingCustom && color === colorId;
                        return (
                            <button
                                key={colorId}
                                type="button"
                                title={colorId}
                                aria-label={`Color ${colorId}`}
                                aria-pressed={selected}
                                className={cn(
                                    "size-6 rounded-md border-2 transition-transform",
                                    swatch.swatchClass,
                                    selected
                                        ? "scale-110 border-foreground"
                                        : "border-transparent opacity-80 hover:opacity-100",
                                )}
                                onClick={() => onColor(colorId)}
                            />
                        );
                    })}
                </div>
                <div className="mt-1 flex items-center gap-2">
                    <Input
                        value={hexDraft}
                        placeholder="#RRGGBB"
                        aria-label={`Custom hex for ${label}`}
                        className="h-8 font-mono text-xs"
                        onChange={(event) => onHexDraftChange(event.target.value)}
                        onBlur={() => onCommitHex(hexDraft)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.currentTarget.blur();
                            }
                        }}
                    />
                    {usingCustom ? (
                        <span
                            className="size-6 shrink-0 rounded-md border-2 border-foreground"
                            style={{ backgroundColor: customColor ?? undefined }}
                            title={customColor ?? undefined}
                        />
                    ) : null}
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Icon</span>
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                    {SECTION_ICON_IDS.map((iconId) => {
                        const OptionIcon = SECTION_ICONS[iconId];
                        const selected = icon === iconId;
                        return (
                            <button
                                key={iconId}
                                type="button"
                                title={iconId}
                                aria-label={`Icon ${iconId}`}
                                aria-pressed={selected}
                                className={cn(
                                    "grid size-7 place-items-center rounded-md border transition-colors",
                                    selected ? "border-foreground bg-muted" : "border-transparent hover:bg-muted/60",
                                )}
                                onClick={() => onIcon(iconId)}
                            >
                                <OptionIcon className="size-3.5" aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
