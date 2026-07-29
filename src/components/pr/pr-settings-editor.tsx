import {
    AlignJustify,
    Columns2,
    FileDiff,
    Files,
    FolderTree,
    Inbox,
    Maximize2,
    MessageSquareOff,
    PanelLeft,
    RemoveFormatting,
    Rows2,
    Workflow,
} from "lucide-react";

import {
    SettingsDialogTitle,
    SettingsPreferenceRow,
    SettingsSectionHeading,
} from "#/components/settings/settings-ui.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader } from "#/components/ui/dialog.tsx";
import { useDiffPreferences } from "#/lib/diff-preferences.ts";
import { cn } from "#/lib/utils.ts";

export function PrSettingsEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [preferences, setPreferences] = useDiffPreferences();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <SettingsDialogTitle
                        icon={FileDiff}
                        toneClassName="border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    >
                        PR Settings
                    </SettingsDialogTitle>
                    <DialogDescription>
                        Defaults for pull request review. Saved in this browser and apply on every pull request.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-5">
                    <section className="flex flex-col gap-3">
                        <SettingsSectionHeading icon={Workflow}>Workflow</SettingsSectionHeading>
                        <SettingsPreferenceRow
                            icon={Inbox}
                            title="Return to Inbox after review or merge"
                            description="After you submit a review or merge a pull request, go back to the Inbox."
                            checked={preferences.returnToInboxAfterReviewOrMerge}
                            onCheckedChange={(returnToInboxAfterReviewOrMerge) =>
                                setPreferences({ returnToInboxAfterReviewOrMerge })
                            }
                        />
                    </section>

                    <section className="flex flex-col gap-3">
                        <SettingsSectionHeading icon={Files}>Files changed</SettingsSectionHeading>
                        <SettingsPreferenceRow
                            icon={Maximize2}
                            title="Full width"
                            description="Expand the Files changed panel to the full viewport width."
                            checked={preferences.fullWidth}
                            onCheckedChange={(fullWidth) => setPreferences({ fullWidth })}
                        />
                        <SettingsPreferenceRow
                            icon={PanelLeft}
                            title="Show file list"
                            description="Keep the changed-files sidebar visible while reviewing."
                            checked={preferences.showFileList}
                            onCheckedChange={(showFileList) => setPreferences({ showFileList })}
                        />
                        <SettingsPreferenceRow
                            icon={FolderTree}
                            title="File tree"
                            description="Group changed files by folder instead of a flat path list."
                            checked={preferences.fileListLayout === "tree"}
                            onCheckedChange={(tree) => setPreferences({ fileListLayout: tree ? "tree" : "flat" })}
                        />
                    </section>

                    <section className="flex flex-col gap-3">
                        <SettingsSectionHeading icon={FileDiff}>Diff display</SettingsSectionHeading>
                        <div className="flex flex-col gap-2">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                                <Columns2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                Layout
                            </p>
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
                        <SettingsPreferenceRow
                            icon={RemoveFormatting}
                            title="Hide whitespace"
                            description="Ignore whitespace-only changes in the diff."
                            checked={preferences.hideWhitespace}
                            onCheckedChange={(hideWhitespace) => setPreferences({ hideWhitespace })}
                        />
                        <SettingsPreferenceRow
                            icon={AlignJustify}
                            title="Compact line height"
                            description="Tighten spacing between diff lines."
                            checked={preferences.compactLineHeight}
                            onCheckedChange={(compactLineHeight) => setPreferences({ compactLineHeight })}
                        />
                        <SettingsPreferenceRow
                            icon={MessageSquareOff}
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
