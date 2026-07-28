import { useSelector } from "@tanstack/react-store";
import { Download, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import type { InboxSectionId } from "#/lib/session/inbox-sections.ts";
import type {
    SectionFilter,
    SectionFilterCase,
    SectionFilterCondition,
    SectionFilterField,
    SectionFilterOp,
} from "#/lib/session/section-filters.ts";

import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import { defaultLabelForSection, isPresetInboxSectionId, sectionFilterSummary } from "#/lib/session/inbox-sections.ts";
import { useSession } from "#/lib/session/provider.tsx";
import {
    INVOLVEMENT_KINDS,
    VIEWER_PERSON,
    defaultValueForField,
    newFilterId,
    normalizeSectionFilter,
    opsForField,
    summarizeSectionFilter,
} from "#/lib/session/section-filters.ts";
import { notifyError, notifySuccess } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

const FIELD_OPTIONS: Array<{ value: SectionFilterField; label: string }> = [
    { value: "involvement", label: "Involvement" },
    { value: "author", label: "Author" },
    { value: "assignees", label: "Assignees" },
    { value: "labels", label: "Labels" },
    { value: "state", label: "PR status" },
    { value: "isDraft", label: "Draft" },
    { value: "reviewDecision", label: "Review decision" },
    { value: "reviewRequests", label: "Requested reviewers" },
    { value: "viewerReviewState", label: "My review" },
    { value: "checks", label: "Checks" },
    { value: "mergeable", label: "Mergeable" },
    { value: "repository", label: "Repository" },
    { value: "title", label: "Title" },
    { value: "headRefName", label: "Head branch" },
    { value: "baseRefName", label: "Base branch" },
    { value: "commentCount", label: "Comments" },
    { value: "changedFiles", label: "Changed files" },
    { value: "additions", label: "Additions" },
    { value: "deletions", label: "Deletions" },
    { value: "updatedWithinDays", label: "Updated (days)" },
];

function fieldLabel(field: SectionFilterField): string {
    return FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field;
}

function opLabel(op: SectionFilterOp): string {
    return op.replaceAll("_", " ");
}

function LabeledSelectTrigger({
    label,
    className,
    children,
    ...props
}: ComponentProps<typeof SelectTrigger> & { label: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <SelectTrigger className={cn("h-8 shrink-0", className)} size="sm" {...props}>
                    {children}
                </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

export function SectionFilterEditor({
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
    const [draft, setDraft] = useState<SectionFilter>({ cases: [] });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open && entry) {
            setDraft(normalizeSectionFilter(entry.filter));
        }
    }, [open, entry]);

    if (!sectionId || !entry) {
        return null;
    }

    const label = entry.label.trim() || defaultLabelForSection(entry.id);
    const preview = session.previewSectionFilter(draft);
    const summary = summarizeSectionFilter(draft);

    function updateCase(caseId: string, patch: Partial<SectionFilterCase>) {
        setDraft((current) => ({
            cases: current.cases.map((filterCase) =>
                filterCase.id === caseId ? { ...filterCase, ...patch } : filterCase,
            ),
        }));
    }

    function updateCondition(caseId: string, conditionId: string, patch: Partial<SectionFilterCondition>) {
        setDraft((current) => ({
            cases: current.cases.map((filterCase) => {
                if (filterCase.id !== caseId) return filterCase;
                return {
                    ...filterCase,
                    conditions: filterCase.conditions.map((condition) =>
                        condition.id === conditionId ? { ...condition, ...patch } : condition,
                    ),
                };
            }),
        }));
    }

    async function save() {
        if (!sectionId) return;
        await session.setSectionFilter(sectionId, draft);
        notifySuccess(`Updated filters for “${label}”`);
        onOpenChange(false);
    }

    function exportSection() {
        if (!sectionId) return;
        const payload = session.exportInboxSection(sectionId);
        if (!payload) return;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `easy-review-section-${sectionId}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        notifySuccess("Section exported");
    }

    async function importSectionFile(file: File) {
        try {
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            const id = await session.importInboxSection(parsed);
            notifySuccess("Section imported as a custom section");
            onOpenChange(false);
            // Caller may want to open the new section — id available if needed later.
            void id;
        } catch (cause) {
            notifyError(cause instanceof Error ? cause.message : "Could not import section.");
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90svh] w-full flex-col gap-4 overflow-hidden sm:max-w-3xl">
                <TooltipProvider delayDuration={300}>
                    <DialogHeader className="min-w-0 shrink-0 pr-8 text-left">
                        <DialogTitle>Edit “{label}”</DialogTitle>
                        <DialogDescription className="text-pretty">
                            Match any named case. Each case needs at least one condition (AND). Empty cases match
                            nothing.
                        </DialogDescription>
                    </DialogHeader>

                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{summary}</p>

                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        {draft.cases.length === 0 ? (
                            <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                                No cases — this section matches <strong>no</strong> pull requests until you add one.
                            </p>
                        ) : (
                            draft.cases.map((filterCase, index) => (
                                <div key={filterCase.id} className="rounded-lg border bg-card p-3">
                                    <div className="mb-2 flex items-center gap-2">
                                        {index > 0 ? (
                                            <span className="w-8 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                Or
                                            </span>
                                        ) : (
                                            <span className="w-8 shrink-0" />
                                        )}
                                        <Input
                                            value={filterCase.name}
                                            placeholder={`Case ${index + 1}`}
                                            aria-label={`Name for case ${index + 1}`}
                                            className="h-8"
                                            onChange={(event) =>
                                                updateCase(filterCase.id, { name: event.target.value })
                                            }
                                        />
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label="Remove case"
                                            onClick={() =>
                                                setDraft((current) => ({
                                                    cases: current.cases.filter((row) => row.id !== filterCase.id),
                                                }))
                                            }
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    </div>

                                    {filterCase.conditions.length === 0 ? (
                                        <p className="mb-2 text-xs text-muted-foreground">
                                            No conditions yet — this case matches nothing.
                                        </p>
                                    ) : null}

                                    <ul className="flex flex-col gap-2">
                                        {filterCase.conditions.map((condition, conditionIndex) => (
                                            <li key={condition.id} className="flex flex-wrap items-center gap-2">
                                                {conditionIndex > 0 ? (
                                                    <span className="w-8 text-xs text-muted-foreground">And</span>
                                                ) : (
                                                    <span className="w-8" />
                                                )}
                                                <ConditionRow
                                                    condition={condition}
                                                    onChange={(patch) =>
                                                        updateCondition(filterCase.id, condition.id, patch)
                                                    }
                                                    onRemove={() =>
                                                        updateCase(filterCase.id, {
                                                            conditions: filterCase.conditions.filter(
                                                                (row) => row.id !== condition.id,
                                                            ),
                                                        })
                                                    }
                                                />
                                            </li>
                                        ))}
                                    </ul>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="mt-2 gap-1.5"
                                        onClick={() => {
                                            const field: SectionFilterField = "state";
                                            updateCase(filterCase.id, {
                                                conditions: [
                                                    ...filterCase.conditions,
                                                    {
                                                        id: newFilterId("c"),
                                                        field,
                                                        op: opsForField(field)[0]!,
                                                        value: defaultValueForField(field),
                                                    },
                                                ],
                                            });
                                        }}
                                    >
                                        <Plus className="size-3.5" />
                                        Add condition
                                    </Button>
                                </div>
                            ))
                        )}

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full gap-1.5"
                            onClick={() =>
                                setDraft((current) => ({
                                    cases: [
                                        ...current.cases,
                                        {
                                            id: newFilterId("case"),
                                            name: `Case ${current.cases.length + 1}`,
                                            // Empty → matches nothing until the user adds conditions.
                                            conditions: [],
                                        },
                                    ],
                                }))
                            }
                        >
                            <Plus className="size-3.5" />
                            Add case
                        </Button>
                    </div>

                    <div className="rounded-md border px-3 py-2 text-sm">
                        <p className="font-medium">
                            {preview.count} matching PR{preview.count === 1 ? "" : "s"}
                        </p>
                        {preview.sample.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-muted-foreground">
                                {preview.sample.map((pullRequest) => (
                                    <li key={pullRequest.key} className="truncate">
                                        {pullRequest.repository}#{pullRequest.number} — {pullRequest.title}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-1 text-muted-foreground">No matches in the current inbox cache.</p>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={exportSection}
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
                                Import…
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) void importSectionFile(file);
                                }}
                            />
                            {isPresetInboxSectionId(entry.id) ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        void session.resetSectionFilter(entry.id).then(() => {
                                            const next = session.getSectionLayout().find((row) => row.id === entry.id);
                                            if (next) setDraft(normalizeSectionFilter(next.filter));
                                            notifySuccess("Filters reset to default");
                                        });
                                    }}
                                >
                                    Reset filters
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="button" onClick={() => void save()}>
                                Save
                            </Button>
                        </div>
                    </div>
                </TooltipProvider>
            </DialogContent>
        </Dialog>
    );
}

function ConditionRow({
    condition,
    onChange,
    onRemove,
}: {
    condition: SectionFilterCondition;
    onChange: (patch: Partial<SectionFilterCondition>) => void;
    onRemove: () => void;
}) {
    const ops = opsForField(condition.field);
    const selectedFieldLabel = fieldLabel(condition.field);
    const selectedOpLabel = opLabel(condition.op);

    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
            <Select
                value={condition.field}
                onValueChange={(field) => {
                    const next = field as SectionFilterField;
                    onChange({
                        field: next,
                        op: opsForField(next)[0],
                        value: defaultValueForField(next),
                    });
                }}
            >
                <LabeledSelectTrigger label={selectedFieldLabel} className="w-[12.5rem]">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    {FIELD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select value={condition.op} onValueChange={(op) => onChange({ op: op as SectionFilterOp })}>
                <LabeledSelectTrigger label={selectedOpLabel} className="w-[9rem]">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    {ops.map((op) => (
                        <SelectItem key={op} value={op}>
                            {opLabel(op)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <ConditionValueInput condition={condition} onChange={onChange} />

            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
                <X className="size-3.5" />
            </Button>
        </div>
    );
}

function ConditionValueInput({
    condition,
    onChange,
}: {
    condition: SectionFilterCondition;
    onChange: (patch: Partial<SectionFilterCondition>) => void;
}) {
    if (condition.field === "isDraft") {
        const label = condition.value === true || condition.value === "true" ? "yes" : "no";
        return (
            <Select
                value={condition.value === true || condition.value === "true" ? "true" : "false"}
                onValueChange={(value) => onChange({ value: value === "true" })}
            >
                <LabeledSelectTrigger label={label} className="w-24">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    <SelectItem value="true">yes</SelectItem>
                    <SelectItem value="false">no</SelectItem>
                </SelectContent>
            </Select>
        );
    }

    if (condition.field === "state") {
        return (
            <Select value={String(condition.value)} onValueChange={(value) => onChange({ value })}>
                <LabeledSelectTrigger label={String(condition.value)} className="w-28">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    <SelectItem value="open">open</SelectItem>
                    <SelectItem value="merged">merged</SelectItem>
                    <SelectItem value="closed">closed</SelectItem>
                </SelectContent>
            </Select>
        );
    }

    if (condition.field === "reviewDecision") {
        const label = condition.value === null || condition.value === "null" ? "none" : String(condition.value);
        return (
            <Select
                value={condition.value === null ? "null" : String(condition.value)}
                onValueChange={(value) => onChange({ value })}
            >
                <LabeledSelectTrigger label={label} className="min-w-[11rem] w-auto max-w-[14rem]">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    <SelectItem value="approved">approved</SelectItem>
                    <SelectItem value="changes-requested">changes-requested</SelectItem>
                    <SelectItem value="review-required">review-required</SelectItem>
                    <SelectItem value="null">none</SelectItem>
                </SelectContent>
            </Select>
        );
    }

    if (condition.field === "involvement") {
        return (
            <Select value={String(condition.value)} onValueChange={(value) => onChange({ value })}>
                <LabeledSelectTrigger label={String(condition.value)} className="w-52">
                    <SelectValue />
                </LabeledSelectTrigger>
                <SelectContent position="popper">
                    {INVOLVEMENT_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                            {kind}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    if (condition.field === "author" || condition.field === "assignees" || condition.field === "reviewRequests") {
        return (
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1">
                <Input
                    className="h-8 min-w-[6rem] flex-1 py-0 text-sm leading-none"
                    value={String(condition.value)}
                    placeholder={VIEWER_PERSON}
                    onChange={(event) => onChange({ value: event.target.value })}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 shrink-0 px-2 text-xs leading-none"
                    onClick={() => onChange({ value: VIEWER_PERSON })}
                >
                    @me
                </Button>
            </div>
        );
    }

    if (
        condition.field === "commentCount" ||
        condition.field === "changedFiles" ||
        condition.field === "additions" ||
        condition.field === "deletions" ||
        condition.field === "updatedWithinDays"
    ) {
        return (
            <Input
                type="number"
                className="h-8 w-24 py-0 text-sm leading-none"
                value={Number(condition.value)}
                onChange={(event) => onChange({ value: Number(event.target.value) })}
            />
        );
    }

    return (
        <Input
            className="h-8 min-w-[6rem] flex-1 py-0 text-sm leading-none"
            value={String(condition.value)}
            onChange={(event) => onChange({ value: event.target.value })}
        />
    );
}

/** Filter summary under a section row — wraps instead of clipping. */
export function SectionFilterSummaryLine({ sectionId }: { sectionId: InboxSectionId }) {
    const session = useSession();
    const entry = useSelector(session.state, () => session.getSectionLayout().find((row) => row.id === sectionId));
    if (!entry) return null;
    const summary = sectionFilterSummary(entry);
    return (
        <p className="min-w-0 pl-9 text-xs leading-snug text-pretty break-words text-muted-foreground" title={summary}>
            {summary}
        </p>
    );
}
