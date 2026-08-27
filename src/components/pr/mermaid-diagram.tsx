import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Check,
    Copy,
    Maximize2,
    RefreshCw,
    UnfoldHorizontal,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { isDarkScheme } from "#/lib/theme.ts";
import { notifyCopied, notifyError } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

type MermaidStatus = { kind: "loading" } | { kind: "ready"; svg: string } | { kind: "error"; message: string };

type ViewTransform = {
    scale: number;
    x: number;
    y: number;
};

const DEFAULT_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.2;
const PAN_STEP = 48;

let mermaidInitTheme: "dark" | "default" | null = null;

function removeMermaidTempElements(renderId: string) {
    document.getElementById(`d${renderId}`)?.remove();
    document.getElementById(renderId)?.remove();
    document.getElementById(`i${renderId}`)?.remove();
}

export async function renderMermaidSvg(code: string, renderId: string, dark: boolean): Promise<string> {
    const mermaid = (await import("mermaid")).default;
    const theme = dark ? "dark" : "default";

    if (mermaidInitTheme !== theme) {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        mermaidInitTheme = theme;
    }

    try {
        const { svg } = await mermaid.render(renderId, code);
        return svg;
    } finally {
        removeMermaidTempElements(renderId);
    }
}

function clampScale(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Client-only Mermaid fence — lazy-loads the library and falls back to the source on error. */
export function MermaidDiagram({ code }: { code: string }) {
    const { theme, resolvedTheme } = useTheme();
    const dark = isDarkScheme(resolvedTheme ?? theme);
    const reactId = useId().replaceAll(":", "");
    const [status, setStatus] = useState<MermaidStatus>({ kind: "loading" });
    const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const renderId = `mermaid-${reactId}-${dark ? "d" : "l"}`;

        setStatus({ kind: "loading" });
        setView(DEFAULT_VIEW);
        void renderMermaidSvg(code, renderId, dark)
            .then((svg) => {
                if (!cancelled) {
                    setStatus({ kind: "ready", svg });
                }
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setStatus({
                        kind: "error",
                        message: cause instanceof Error ? cause.message : "Could not render diagram",
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [code, dark, reactId]);

    if (status.kind === "error") {
        return (
            <div className="my-3 space-y-1 not-prose">
                <p className="text-xs text-muted-foreground">Mermaid: {status.message}</p>
                <pre className="m-0 overflow-x-auto rounded-md bg-muted/70 p-3 font-mono text-[12px] leading-5 whitespace-pre dark:bg-muted/40">
                    {code}
                </pre>
            </div>
        );
    }

    if (status.kind === "loading") {
        return (
            <div
                className="my-3 min-h-24 animate-pulse rounded-md border bg-muted/40 not-prose"
                aria-busy="true"
                aria-label="Rendering diagram"
            />
        );
    }

    return (
        <>
            <MermaidViewport
                svg={status.svg}
                code={code}
                view={view}
                onViewChange={setView}
                expanded={false}
                onToggleExpand={() => setExpanded(true)}
            />
            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent
                    className="flex h-[min(90svh,56rem)] w-[min(96vw,80rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
                    aria-describedby={undefined}
                >
                    <DialogTitle className="sr-only">Expanded Mermaid diagram</DialogTitle>
                    <MermaidViewport
                        svg={status.svg}
                        code={code}
                        view={view}
                        onViewChange={setView}
                        expanded
                        onToggleExpand={() => setExpanded(false)}
                        className="my-0 h-full min-h-0 rounded-none border-0"
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}

function MermaidViewport({
    svg,
    code,
    view,
    onViewChange,
    expanded,
    onToggleExpand,
    className,
}: {
    svg: string;
    code: string;
    view: ViewTransform;
    onViewChange: (view: ViewTransform | ((current: ViewTransform) => ViewTransform)) => void;
    expanded: boolean;
    onToggleExpand: () => void;
    className?: string;
}) {
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null>(null);
    const [dragging, setDragging] = useState(false);

    function zoomBy(delta: number) {
        onViewChange((current) => ({ ...current, scale: clampScale(current.scale + delta) }));
    }

    function panBy(dx: number, dy: number) {
        onViewChange((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }

    function resetView() {
        onViewChange(DEFAULT_VIEW);
    }

    function onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) {
            return;
        }
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: view.x,
            originY: view.y,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        onViewChange({
            scale: view.scale,
            x: drag.originX + (event.clientX - drag.startX),
            y: drag.originY + (event.clientY - drag.startY),
        });
    }

    function endDrag(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }

    function onWheel(event: React.WheelEvent<HTMLDivElement>) {
        if (!(event.metaKey || event.ctrlKey)) {
            return;
        }
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }

    return (
        <div className={cn("my-3 flex flex-col overflow-hidden rounded-md border bg-background not-prose", className)}>
            <div
                ref={stageRef}
                className={cn(
                    "relative min-h-40 flex-1 overflow-hidden bg-background",
                    dragging ? "cursor-grabbing" : "cursor-grab",
                    expanded ? "min-h-0" : "max-h-[min(70vh,36rem)]",
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onWheel={onWheel}
            >
                <div
                    className="flex h-full w-full items-center justify-center p-3 transition-transform duration-75 ease-out motion-reduce:transition-none [&_svg]:max-w-none"
                    style={{
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        transformOrigin: "center center",
                    }}
                    // Mermaid SVG is produced with securityLevel: "strict".
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            </div>

            <MermaidControls
                code={code}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onZoomIn={() => zoomBy(ZOOM_STEP)}
                onZoomOut={() => zoomBy(-ZOOM_STEP)}
                onPan={panBy}
                onReset={resetView}
            />
        </div>
    );
}

function MermaidControls({
    code,
    expanded,
    onToggleExpand,
    onZoomIn,
    onZoomOut,
    onPan,
    onReset,
}: {
    code: string;
    expanded: boolean;
    onToggleExpand: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onPan: (dx: number, dy: number) => void;
    onReset: () => void;
}) {
    const [copied, setCopied] = useState(false);

    function copySource() {
        void navigator.clipboard.writeText(code).then(
            () => {
                notifyCopied("Mermaid");
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            },
            () => notifyError("Could not copy"),
        );
    }

    return (
        <div className="flex flex-wrap items-end justify-between gap-3 border-t bg-muted/30 px-2 py-2">
            <div className="flex items-center gap-1">
                <ControlButton label={expanded ? "Exit expanded view" : "Expand diagram"} onClick={onToggleExpand}>
                    {expanded ? <Maximize2 className="size-3.5" /> : <UnfoldHorizontal className="size-3.5" />}
                </ControlButton>
                <ControlButton label="Copy Mermaid source" onClick={copySource}>
                    {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                </ControlButton>
            </div>

            <div className="flex items-end gap-2">
                <div className="grid grid-cols-3 grid-rows-3 gap-0.5" role="group" aria-label="Pan diagram">
                    <span />
                    <ControlButton label="Pan up" onClick={() => onPan(0, PAN_STEP)}>
                        <ArrowUp className="size-3.5" />
                    </ControlButton>
                    <span />
                    <ControlButton label="Pan left" onClick={() => onPan(PAN_STEP, 0)}>
                        <ArrowLeft className="size-3.5" />
                    </ControlButton>
                    <ControlButton label="Reset view" onClick={onReset}>
                        <RefreshCw className="size-3.5" />
                    </ControlButton>
                    <ControlButton label="Pan right" onClick={() => onPan(-PAN_STEP, 0)}>
                        <ArrowRight className="size-3.5" />
                    </ControlButton>
                    <span />
                    <ControlButton label="Pan down" onClick={() => onPan(0, -PAN_STEP)}>
                        <ArrowDown className="size-3.5" />
                    </ControlButton>
                    <span />
                </div>

                <div className="flex flex-col gap-0.5" role="group" aria-label="Zoom diagram">
                    <ControlButton label="Zoom in" onClick={onZoomIn}>
                        <ZoomIn className="size-3.5" />
                    </ControlButton>
                    <ControlButton label="Zoom out" onClick={onZoomOut}>
                        <ZoomOut className="size-3.5" />
                    </ControlButton>
                </div>
            </div>
        </div>
    );
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <HelpTooltip label={label}>
            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-7 bg-background text-foreground shadow-none"
                aria-label={label}
                onClick={(event) => {
                    event.stopPropagation();
                    onClick();
                }}
            >
                {children}
            </Button>
        </HelpTooltip>
    );
}
