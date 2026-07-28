import { Columns2, Rows2 } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useDiffPreferences } from "#/lib/diff-preferences.ts";
import { cn } from "#/lib/utils.ts";

export function PrSettingsEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [preferences, setPreferences] = useDiffPreferences();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>PR Settings</DialogTitle>
                    <DialogDescription>
                        Defaults for the Files changed panel. Saved in this browser and apply on every pull request.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-5">
                    <section className="flex flex-col gap-3">
                        <h3 className="text-xs font-medium text-muted-foreground">Files changed</h3>
                        <PreferenceRow
                            title="Full width"
                            description="Expand the Files changed panel to the full viewport width."
                            checked={preferences.fullWidth}
                            onCheckedChange={(fullWidth) => setPreferences({ fullWidth })}
                        />
                        <PreferenceRow
                            title="Show file list"
                            description="Keep the changed-files sidebar visible while reviewing."
                            checked={preferences.showFileList}
                            onCheckedChange={(showFileList) => setPreferences({ showFileList })}
                        />
                        <PreferenceRow
                            title="File tree"
                            description="Group changed files by folder instead of a flat path list."
                            checked={preferences.fileListLayout === "tree"}
                            onCheckedChange={(tree) => setPreferences({ fileListLayout: tree ? "tree" : "flat" })}
                        />
                    </section>

                    <section className="flex flex-col gap-3">
                        <h3 className="text-xs font-medium text-muted-foreground">Diff display</h3>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm font-medium">Layout</p>
                            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Diff layout">
                                <LayoutOption
                                    label="Unified"
                                    icon={Rows2}
                                    selected={preferences.layout === "unified"}
                                    onSelect={() => setPreferences({ layout: "unified" })}
                                />
                                <LayoutOption
                                    label="Split"
                                    icon={Columns2}
                                    selected={preferences.layout === "split"}
                                    onSelect={() => setPreferences({ layout: "split" })}
                                />
                            </div>
                        </div>
                        <PreferenceRow
                            title="Hide whitespace"
                            description="Ignore whitespace-only changes in the diff."
                            checked={preferences.hideWhitespace}
                            onCheckedChange={(hideWhitespace) => setPreferences({ hideWhitespace })}
                        />
                        <PreferenceRow
                            title="Compact line height"
                            description="Tighten spacing between diff lines."
                            checked={preferences.compactLineHeight}
                            onCheckedChange={(compactLineHeight) => setPreferences({ compactLineHeight })}
                        />
                        <PreferenceRow
                            title="Minimize comments"
                            description="Collapse review threads under each file so the diff stays readable."
                            checked={preferences.minimizeComments}
                            onCheckedChange={(minimizeComments) => setPreferences({ minimizeComments })}
                        />
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function PreferenceRow({
    title,
    description,
    checked,
    onCheckedChange,
}: {
    title: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border px-3 py-2.5">
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
            </span>
            <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
        </label>
    );
}

function LayoutOption({
    label,
    icon: Icon,
    selected,
    onSelect,
}: {
    label: string;
    icon: typeof Rows2;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <Button
            type="button"
            role="radio"
            aria-checked={selected}
            variant="outline"
            className={cn("h-auto flex-col gap-1.5 py-3", selected && "border-ring ring-2 ring-ring/30")}
            onClick={onSelect}
        >
            <Icon className="size-4" aria-hidden="true" />
            {label}
        </Button>
    );
}
