import { describe, expect, it } from "vitest";

import { buildHead, formatTitle, pullRequestHead, pullRequestSeo, siteName } from "#/lib/seo.ts";

describe("seo", () => {
    it("formats page titles with the site suffix", () => {
        expect(formatTitle("Inbox")).toBe(`Inbox · ${siteName()}`);
        expect(formatTitle(siteName())).toBe(siteName());
        expect(formatTitle("")).toBe(siteName());
    });

    it("builds dedupe-friendly head meta for a page", () => {
        const head = buildHead({
            title: "Inbox",
            description: "Your pull request triage board.",
        });

        expect(head.meta).toContainEqual({ title: formatTitle("Inbox") });
        expect(head.meta).toContainEqual({
            name: "description",
            content: "Your pull request triage board.",
        });
        expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
        expect(head.meta).toContainEqual({ property: "og:title", content: formatTitle("Inbox") });
        expect(head.meta).toContainEqual({ property: "og:image", content: "/og-image.png" });
        expect(head.meta).toContainEqual({ name: "twitter:image", content: "/og-image.png" });
    });

    it("generates pull request SEO from params and optional headline", () => {
        expect(pullRequestSeo({ owner: "acme", repo: "api", number: 12 })).toEqual({
            title: "acme/api#12",
            description: "Review pull request #12 in acme/api with Easy Review.",
            path: "/pr/acme/api/12",
        });

        expect(
            pullRequestHead({
                owner: "acme",
                repo: "api",
                number: 12,
                title: "Add rate limiting",
            }).meta,
        ).toContainEqual({
            title: formatTitle("Add rate limiting · acme/api#12"),
        });
    });
});
