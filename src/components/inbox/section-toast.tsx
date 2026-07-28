import { toast } from "sonner";

import type { SectionVisual } from "#/components/inbox/section-visuals.ts";

import { cn } from "#/lib/utils.ts";

/** Success-style toast that uses the section’s color chip instead of a green check. */
export function notifySectionAdded(message: string, visual: SectionVisual): void {
    const Icon = visual.icon;
    toast(message, {
        icon: (
            <span
                className={cn("grid size-5 place-items-center rounded-md", visual.chipClass)}
                style={visual.tones?.chip}
            >
                <Icon className={cn("size-3", visual.iconClass)} style={visual.tones?.icon} aria-hidden="true" />
            </span>
        ),
    });
}
