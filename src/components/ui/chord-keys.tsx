import { cn } from "#/lib/utils.ts";

/** Keyboard chord display: sequence (`C` then `L`) or modifier combo (`⌘` `1`). */
export function ChordKeys({
    keys,
    className,
    mode = "sequence",
}: {
    keys: Array<string> | string;
    className?: string;
    mode?: "sequence" | "combo";
}) {
    const parts = typeof keys === "string" ? keys.trim().split(/\s+/).filter(Boolean) : keys;

    if (parts.length === 0) {
        return null;
    }

    return (
        <span className={cn("inline-flex items-center gap-1 tracking-normal", className)}>
            {parts.map((key, index) => (
                <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
                    {mode === "sequence" && index > 0 ? (
                        <span className="text-[10px] font-normal text-muted-foreground/80">then</span>
                    ) : null}
                    <kbd className="rounded border bg-muted px-1 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                        {key}
                    </kbd>
                </span>
            ))}
        </span>
    );
}
