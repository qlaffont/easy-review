import { describe, expect, it } from "vitest";

import {
    isLineVisibleInScroller,
    selectionCommentAnchor,
    selectionCommentCoordsFromAnchor,
} from "#/lib/diff-selection-comment.ts";

describe("selectionCommentAnchor", () => {
    const lineRect = { left: 400, right: 900, top: 620, bottom: 642 };

    it("pins y to the line box even when a transformed range would report the editor top", () => {
        const result = selectionCommentAnchor({ lineRect, mouseX: 530 });
        expect(result.y).toBe(620);
        expect(result.x).toBe(530);
        expect(result.xOffset).toBe(130);
    });

    it("clamps the pointer to the line when it lands left of the code", () => {
        expect(selectionCommentAnchor({ lineRect, mouseX: 10 }).x).toBe(400);
    });

    it("clamps the pointer to the line when it lands right of the code", () => {
        expect(selectionCommentAnchor({ lineRect, mouseX: 1200 }).x).toBe(900);
    });
});

describe("selectionCommentCoordsFromAnchor", () => {
    it("keeps the horizontal offset when the line moves after scroll", () => {
        const before = { left: 400, right: 900, top: 620, bottom: 642 };
        const { xOffset } = selectionCommentAnchor({ lineRect: before, mouseX: 530 });
        const after = { left: 400, right: 900, top: 400, bottom: 422 };
        expect(selectionCommentCoordsFromAnchor({ lineRect: after, xOffset })).toEqual({ x: 530, y: 400 });
    });
});

describe("isLineVisibleInScroller", () => {
    const scroller = { left: 0, right: 800, top: 200, bottom: 700 };

    it("is visible when the line overlaps the file editor", () => {
        expect(isLineVisibleInScroller({ left: 400, right: 900, top: 620, bottom: 642 }, scroller)).toBe(true);
    });

    it("is hidden when the line is above the file editor", () => {
        expect(isLineVisibleInScroller({ left: 400, right: 900, top: 10, bottom: 32 }, scroller)).toBe(false);
    });

    it("is hidden when the line is below the file editor", () => {
        expect(isLineVisibleInScroller({ left: 400, right: 900, top: 720, bottom: 742 }, scroller)).toBe(false);
    });

    it("is hidden when the line element is gone", () => {
        expect(isLineVisibleInScroller(null, scroller)).toBe(false);
    });
});
