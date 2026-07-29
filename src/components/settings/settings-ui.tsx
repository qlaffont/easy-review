import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DialogTitle } from "#/components/ui/dialog.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { cn } from "#/lib/utils.ts";

export function SettingsDialogTitle({
    icon: Icon,
    toneClassName,
    children,
}: {
    icon: LucideIcon;
    toneClassName: string;
    children: ReactNode;
}) {
    return (
        <DialogTitle className="flex items-center gap-2">
            <span
                className={cn("grid size-7 shrink-0 place-items-center rounded-md border", toneClassName)}
                aria-hidden="true"
            >
                <Icon className="size-3.5" />
            </span>
            {children}
        </DialogTitle>
    );
}

export function SettingsSectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
    return (
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
            {children}
        </h3>
    );
}

export function SettingsPreferenceRow({
    icon: Icon,
    title,
    description,
    checked,
    onCheckedChange,
    disabled = false,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <label
            className={cn(
                "flex items-start justify-between gap-3 rounded-md border px-3 py-2.5",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
        >
            <span className="flex min-w-0 items-start gap-3">
                <span
                    className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground"
                    aria-hidden="true"
                >
                    <Icon className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                </span>
            </span>
            <Switch
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
                className="mt-0.5 shrink-0"
            />
        </label>
    );
}
