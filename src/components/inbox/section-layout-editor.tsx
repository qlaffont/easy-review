import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSelector } from "@tanstack/react-store";
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    Filter,
    GripVertical,
    Plus,
    Trash2,
    Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
    InboxSectionId,
    InboxSectionLayoutEntry,
    SectionColorId,
    SectionIconId,
} from "#/lib/session/inbox-sections.ts";
import type { SectionRecipeId } from "#/lib/session/section-filters.ts";

import { SectionFilterEditor, SectionFilterSummaryLine } from "#/components/inbox/section-filter-editor.tsx";
import { notifySectionAdded } from "#/components/inbox/section-toast.tsx";
import {
    SECTION_COLOR_STYLES,
    SECTION_ICONS,
    resolveSectionVisual,
    visualForSection,
} from "#/components/inbox/section-visuals.ts";
import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
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
import { SECTION_RECIPES } from "#/lib/session/section-filters.ts";
import { notifyError, notifySuccess } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

export function SectionLayoutEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const session = useSession();
    const layout = useSelector(session.state, () => session.getSectionLayout());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sectionImportRef = useRef<HTMLInputElement>(null);
    const [filterSectionId, setFilterSectionId] = useState<InboxSectionId | null>(null);

    const visible = layout.filter((entry) => !entry.hidden);
    const hiddenPresetsById = new Map(
        layout.filter((entry) => entry.hidden && entry.kind === "preset").map((entry) => [entry.id, entry]),
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }
        const fromIndex = visible.findIndex((entry) => entry.id === active.id);
        const toIndex = visible.findIndex((entry) => entry.id === over.id);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
            return;
        }
        void session.reorderVisibleSection(active.id as InboxSectionId, toIndex);
    }

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

    async function importSectionFile(file: File) {
        try {
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            await session.importInboxSection(parsed);
            notifySuccess("Section imported");
        } catch (cause) {
            notifyError(cause instanceof Error ? cause.message : "Could not import section.");
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="flex max-h-[90svh] w-full flex-col gap-4 overflow-hidden sm:max-w-2xl">
                    <DialogHeader className="min-w-0 shrink-0 space-y-1.5 pr-8 text-left">
                        <DialogTitle>Inbox sections</DialogTitle>
                        <DialogDescription className="text-pretty">
                            Hide, rename, reorder, and restyle buckets — or edit their filters. Sections match
                            independently, so the same PR can appear in more than one. Saved in this browser.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={exportSettings}
                            >
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
                                    if (file) void importSettingsFile(file);
                                }}
                            />
                            <input
                                ref={sectionImportRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) void importSectionFile(file);
                                }}
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" className="gap-1.5">
                                        <Plus className="size-3.5" />
                                        Add section
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-80 min-w-64 overflow-y-auto">
                                    <DropdownMenuItem onSelect={() => sectionImportRef.current?.click()}>
                                        Import section JSON…
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>Recipes</DropdownMenuLabel>
                                    {SECTION_RECIPES.map((recipe) => {
                                        const hiddenPreset = hiddenPresetsById.get(recipe.id);
                                        const visual = hiddenPreset
                                            ? visualForSection(hiddenPreset.id, hiddenPreset)
                                            : resolveSectionVisual(recipe.color, recipe.icon);
                                        const OptionIcon = visual.icon;
                                        const label = hiddenPreset
                                            ? hiddenPreset.label.trim() || defaultLabelForSection(hiddenPreset.id)
                                            : recipe.label;
                                        return (
                                            <DropdownMenuItem
                                                key={recipe.id}
                                                className="gap-2"
                                                title={recipe.description}
                                                onSelect={() => {
                                                    if (hiddenPreset) {
                                                        void session
                                                            .setSectionHidden(hiddenPreset.id, false)
                                                            .then(() => notifySectionAdded(`Added “${label}”`, visual));
                                                        return;
                                                    }
                                                    void session
                                                        .addCustomSection(recipe.id as SectionRecipeId)
                                                        .then(() =>
                                                            notifySectionAdded(
                                                                `Added “${recipe.suggestedLabel}”`,
                                                                visual,
                                                            ),
                                                        );
                                                }}
                                            >
                                                <span
                                                    className={cn(
                                                        "grid size-6 shrink-0 place-items-center rounded-md",
                                                        visual.chipClass,
                                                    )}
                                                    style={visual.tones?.chip}
                                                >
                                                    <OptionIcon
                                                        className={cn("size-3.5", visual.iconClass)}
                                                        style={visual.tones?.icon}
                                                        aria-hidden="true"
                                                    />
                                                </span>
                                                <span className="min-w-0 truncate">{label}</span>
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
                                void session
                                    .resetSectionLayout()
                                    .then(() => notifySuccess("Sections reset to defaults"));
                            }}
                        >
                            Reset
                        </Button>
                    </div>

                    {visible.length === 0 ? (
                        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                            No sections on the Inbox. Add one above.
                        </p>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={visible.map((entry) => entry.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                                    {visible.map((entry, index) => (
                                        <SectionLayoutRow
                                            key={entry.id}
                                            entry={entry}
                                            isFirst={index === 0}
                                            isLast={index === visible.length - 1}
                                            onLabel={(nextLabel) => void session.setSectionLabel(entry.id, nextLabel)}
                                            onColor={(color) => void session.setSectionColor(entry.id, color)}
                                            onCustomColor={(customColor) =>
                                                void session.setSectionCustomColor(entry.id, customColor)
                                            }
                                            onIcon={(icon) => void session.setSectionIcon(entry.id, icon)}
                                            onDefaultExpanded={(defaultExpanded) =>
                                                void session.setSectionDefaultExpanded(entry.id, defaultExpanded)
                                            }
                                            onEditFilters={() => setFilterSectionId(entry.id)}
                                            onDuplicate={() => {
                                                void session.duplicateSection(entry.id).then((id) => {
                                                    if (id) notifySuccess("Section duplicated");
                                                });
                                            }}
                                            onRemove={() => {
                                                const sectionLabel =
                                                    entry.label.trim() || defaultLabelForSection(entry.id);
                                                if (entry.kind === "custom") {
                                                    void session
                                                        .deleteSection(entry.id)
                                                        .then(() => notifySuccess(`Deleted “${sectionLabel}”`));
                                                    return;
                                                }
                                                void session
                                                    .setSectionHidden(entry.id, true)
                                                    .then(() => notifySuccess(`Removed “${sectionLabel}”`));
                                            }}
                                            onMove={(direction) => {
                                                void session.moveSection(entry.id, direction);
                                            }}
                                        />
                                    ))}
                                </ul>
                            </SortableContext>
                        </DndContext>
                    )}
                </DialogContent>
            </Dialog>

            <SectionFilterEditor
                sectionId={filterSectionId}
                open={filterSectionId !== null}
                onOpenChange={(next) => {
                    if (!next) setFilterSectionId(null);
                }}
            />
        </>
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
    onEditFilters,
    onDuplicate,
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
    onEditFilters: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
}) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
        id: entry.id,
    });
    const visual = visualForSection(entry.id, entry);
    const Icon = visual.icon;
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [hexDraft, setHexDraft] = useState(entry.customColor ?? "");

    useEffect(() => {
        setHexDraft(entry.customColor ?? "");
    }, [entry.customColor]);

    const usingCustom = Boolean(entry.customColor);
    const sectionLabel = entry.label.trim() || defaultLabelForSection(entry.id);

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
            ref={setNodeRef}
            className={cn(
                "flex min-w-0 flex-col gap-2 rounded-md border border-l-[3px] px-3 py-2",
                visual.accentClass,
                isDragging && "z-10 opacity-80 shadow-md",
            )}
            style={{
                ...visual.tones?.accent,
                transform: CSS.Transform.toString(transform),
                transition,
            }}
        >
            <div className="flex min-w-0 items-center gap-1.5">
                <button
                    type="button"
                    ref={setActivatorNodeRef}
                    className="inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                    aria-label={`Drag to reorder ${sectionLabel}`}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="size-4" aria-hidden="true" />
                </button>
                <span
                    className={cn("grid size-7 shrink-0 place-items-center rounded-md", visual.chipClass)}
                    style={visual.tones?.chip}
                >
                    <Icon className={cn("size-3.5", visual.iconClass)} style={visual.tones?.icon} aria-hidden="true" />
                </span>
                <Input
                    value={entry.label}
                    aria-label={`Name for ${entry.id}`}
                    className="min-w-0 flex-1"
                    onChange={(event) => onLabel(event.target.value)}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit filters for ${sectionLabel}`}
                        onClick={onEditFilters}
                    >
                        <Filter />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Duplicate ${sectionLabel}`}
                        onClick={onDuplicate}
                    >
                        <Copy />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isFirst}
                        aria-label={`Move ${sectionLabel} up`}
                        onClick={() => onMove("up")}
                    >
                        <ArrowUp />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isLast}
                        aria-label={`Move ${sectionLabel} down`}
                        onClick={() => onMove("down")}
                    >
                        <ArrowDown />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={entry.kind === "custom" ? `Delete ${sectionLabel}` : `Remove ${sectionLabel}`}
                        onClick={onRemove}
                    >
                        <Trash2 />
                    </Button>
                </div>
            </div>

            <SectionFilterSummaryLine sectionId={entry.id} />

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pl-16">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                        checked={entry.defaultExpanded}
                        onCheckedChange={onDefaultExpanded}
                        aria-label={`Expand ${sectionLabel} by default`}
                    />
                    Expanded by default
                </label>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => setAppearanceOpen((current) => !current)}
                >
                    {appearanceOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    Appearance
                </Button>
            </div>

            {appearanceOpen ? (
                <div className="flex flex-col gap-3 border-t pt-2 pl-16">
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Color</span>
                        <div className="flex flex-wrap gap-1.5">
                            {SECTION_COLOR_IDS.map((colorId) => {
                                const swatch = SECTION_COLOR_STYLES[colorId];
                                const selected = !usingCustom && entry.color === colorId;
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
                                aria-label={`Custom hex for ${sectionLabel}`}
                                className="h-8 font-mono text-xs"
                                onChange={(event) => setHexDraft(event.target.value)}
                                onBlur={() => commitHex(hexDraft)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            {usingCustom ? (
                                <span
                                    className="size-6 shrink-0 rounded-md border-2 border-foreground"
                                    style={{ backgroundColor: entry.customColor ?? undefined }}
                                    title={entry.customColor ?? undefined}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Icon</span>
                        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                            {SECTION_ICON_IDS.map((iconId) => {
                                const OptionIcon = SECTION_ICONS[iconId];
                                const selected = entry.icon === iconId;
                                return (
                                    <button
                                        key={iconId}
                                        type="button"
                                        title={iconId}
                                        aria-label={`Icon ${iconId}`}
                                        aria-pressed={selected}
                                        className={cn(
                                            "grid size-7 place-items-center rounded-md border transition-colors",
                                            selected
                                                ? "border-foreground bg-muted"
                                                : "border-transparent hover:bg-muted/60",
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
            ) : null}
        </li>
    );
}
