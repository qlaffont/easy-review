import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTabFavicon, pullRequestFavicon, type TabFavicon } from "#/lib/tab-favicon.ts";

const ICONS: ReadonlyArray<TabFavicon> = ["inbox", "inbox-new", "pr-open", "pr-draft", "pr-merged", "pr-closed"];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("pullRequestFavicon", () => {
    it.each([
        [{ state: "open", isDraft: false }, "pr-open"],
        [{ state: "open", isDraft: true }, "pr-draft"],
        [{ state: "merged", isDraft: false }, "pr-merged"],
        [{ state: "closed", isDraft: false }, "pr-closed"],
        // GitHub keeps isDraft on a draft that was closed: the final state wins.
        [{ state: "closed", isDraft: true }, "pr-closed"],
    ] as const)("maps %o to %s", (pullRequest, icon) => {
        expect(pullRequestFavicon(pullRequest)).toBe(icon);
    });
});

describe("applyTabFavicon", () => {
    it("points each icon link at the file of its own format", () => {
        const png = { type: "image/png", href: "/favicon-inbox.png" };
        const svg = { type: "image/svg+xml", href: "/favicon-inbox.svg" };
        const querySelectorAll = vi.fn(() => [png, svg]);
        vi.stubGlobal("document", { querySelectorAll });

        applyTabFavicon("pr-merged");

        expect(querySelectorAll).toHaveBeenCalledWith('link[rel="icon"]');
        expect(png.href).toBe("/favicon-pr-merged.png");
        expect(svg.href).toBe("/favicon-pr-merged.svg");
    });

    it.each(ICONS)("has both files in public/ for %s", (icon) => {
        expect(existsSync(`public/favicon-${icon}.png`)).toBe(true);
        expect(existsSync(`public/favicon-${icon}.svg`)).toBe(true);
    });
});
