import { Check, Info, Settings } from "lucide-react";

import type { DiffPreferences } from "#/lib/diff-preferences.ts";

import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";

export function DiffSettingsMenu({
    preferences,
    onChange,
}: {
    preferences: DiffPreferences;
    onChange: (patch: Partial<DiffPreferences>) => void;
}) {
    return (
        <DropdownMenu>
            <HelpTooltip label="Diff display settings">
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-8"
                        aria-label="Diff settings"
                    >
                        <Settings className="size-3.5" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
            </HelpTooltip>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Layout</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onChange({ layout: "unified" })}>
                    <Check
                        className={preferences.layout === "unified" ? "opacity-100" : "opacity-0"}
                        aria-hidden="true"
                    />
                    Unified
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onChange({ layout: "split" })}>
                    <Check
                        className={preferences.layout === "split" ? "opacity-100" : "opacity-0"}
                        aria-hidden="true"
                    />
                    Split
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                    checked={preferences.showFileList}
                    onCheckedChange={(checked) => onChange({ showFileList: checked === true })}
                >
                    <span className="flex flex-1 items-center gap-1.5">
                        Show file list
                        <HelpTooltip label="Hide the sidebar to give the diff more horizontal space while reviewing.">
                            <span className="inline-flex">
                                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            </span>
                        </HelpTooltip>
                    </span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                    checked={preferences.fullWidth}
                    onCheckedChange={(checked) => onChange({ fullWidth: checked === true })}
                >
                    <span className="flex flex-1 items-center gap-1.5">
                        Full width
                        <HelpTooltip label="Expand only the Files changed panel to the full viewport width.">
                            <span className="inline-flex">
                                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            </span>
                        </HelpTooltip>
                    </span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                    checked={preferences.minimizeComments}
                    onCheckedChange={(checked) => onChange({ minimizeComments: checked === true })}
                >
                    <span className="flex flex-1 items-center gap-1.5">
                        Minimize comments
                        <HelpTooltip label="Collapse review threads under each file so the diff stays readable.">
                            <span className="inline-flex">
                                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            </span>
                        </HelpTooltip>
                    </span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                    checked={preferences.hideWhitespace}
                    onCheckedChange={(checked) => onChange({ hideWhitespace: checked === true })}
                >
                    Hide whitespace
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                    checked={preferences.compactLineHeight}
                    onCheckedChange={(checked) => onChange({ compactLineHeight: checked === true })}
                >
                    Compact line height
                </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
