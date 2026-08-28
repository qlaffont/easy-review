/** Viewport box used to pin the select-to-comment popup to a diff line. */
export type ViewportBox = { left: number; right: number; top: number; bottom: number };

/**
 * Anchor the comment popup to the line element, not the text Range.
 * Virtualized rows use `transform: translateY`, and Range.getBoundingClientRect()
 * often reports the untransformed y (top of the editor) instead of the painted line.
 */
export function selectionCommentAnchor(args: { lineRect: ViewportBox; mouseX: number }): {
    x: number;
    y: number;
    xOffset: number;
} {
    const x = Math.min(args.lineRect.right, Math.max(args.lineRect.left, args.mouseX));
    return {
        x,
        y: args.lineRect.top,
        xOffset: x - args.lineRect.left,
    };
}

/** Re-apply a stored offset after the line moves (scroll, virtualization, horizontal pan). */
export function selectionCommentCoordsFromAnchor(args: { lineRect: ViewportBox; xOffset: number }): {
    x: number;
    y: number;
} {
    return {
        x: args.lineRect.left + args.xOffset,
        y: args.lineRect.top,
    };
}

/** False when the line has been virtualized away or scrolled out of the file editor. */
export function isLineVisibleInScroller(lineRect: ViewportBox | null, scrollerRect: ViewportBox): boolean {
    if (!lineRect) {
        return false;
    }
    return lineRect.bottom > scrollerRect.top && lineRect.top < scrollerRect.bottom;
}
