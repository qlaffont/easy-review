import { useEffect, useRef, useState } from "react";

import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { cn } from "#/lib/utils.ts";

/** Truncates with ellipsis; shows a tooltip with the full text only when overflowed. */
export function TruncatedText({
    text,
    className,
    tooltipSide = "top",
}: {
    text: string;
    className?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
    const textRef = useRef<HTMLSpanElement>(null);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        const el = textRef.current;
        if (!el) {
            return;
        }

        const update = () => {
            setTruncated(el.scrollWidth > el.clientWidth + 1);
        };

        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [text]);

    const label = (
        <span ref={textRef} className={cn("block truncate", className)}>
            {text}
        </span>
    );

    return (
        <span className="min-w-0 flex-1">
            {truncated ? (
                <HelpTooltip label={text} side={tooltipSide} align="start">
                    {label}
                </HelpTooltip>
            ) : (
                label
            )}
        </span>
    );
}
