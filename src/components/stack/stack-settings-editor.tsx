import { GitPullRequestClosed, Layers } from "lucide-react";

import { SettingsDialogTitle, SettingsPreferenceRow } from "#/components/settings/settings-ui.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader } from "#/components/ui/dialog.tsx";
import { useStackPreferences } from "#/lib/stack-preferences.ts";

export function StackSettingsEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [stackPreferences, setStackPreferences] = useStackPreferences();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <SettingsDialogTitle
                        icon={Layers}
                        toneClassName="border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    >
                        Stack Settings
                    </SettingsDialogTitle>
                    <DialogDescription>
                        Detect stacked pull requests from branch names in the same repo. Saved in this browser.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <SettingsPreferenceRow
                        icon={Layers}
                        title="Show pull request stacks"
                        description="Show stack badges in the Inbox and the stack panel on pull requests. Disabled by default."
                        checked={stackPreferences.enabled}
                        onCheckedChange={(enabled) => setStackPreferences({ enabled })}
                    />
                    <SettingsPreferenceRow
                        icon={GitPullRequestClosed}
                        title="Hide closed pull requests in stacks"
                        description="Keep closed PRs out of stack badges and the stack panel."
                        checked={stackPreferences.hideClosed}
                        onCheckedChange={(hideClosed) => setStackPreferences({ hideClosed })}
                        disabled={!stackPreferences.enabled}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
