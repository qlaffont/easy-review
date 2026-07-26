import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";

/** App-wide hover/focus hint. Prefer this over native `title` attributes. */
export function HelpTooltip({
    label,
    children,
    side = "top",
    align = "center",
    sideOffset = 4,
}: {
    label: ReactNode;
    children: ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    sideOffset?: number;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side={side} align={align} sideOffset={sideOffset}>
                {label}
            </TooltipContent>
        </Tooltip>
    );
}
