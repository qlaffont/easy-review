import { describe, expect, it } from "vitest";

import { CACHE_POLICY, isQueryFresh, shouldBackgroundRevalidate } from "#/lib/query/cache-policy.ts";

describe("cache-policy", () => {
    it("treats data inside staleTime as fresh", () => {
        const recent = new Date(Date.now() - 30_000).toISOString();
        expect(isQueryFresh(recent, CACHE_POLICY.inbox.staleTime)).toBe(true);
    });

    it("treats data outside staleTime as stale", () => {
        const old = new Date(Date.now() - CACHE_POLICY.inbox.staleTime - 1).toISOString();
        expect(isQueryFresh(old, CACHE_POLICY.inbox.staleTime)).toBe(false);
    });

    it("skips background revalidate when inside the min interval", () => {
        const recent = new Date(Date.now() - 30_000).toISOString();
        expect(shouldBackgroundRevalidate(recent, CACHE_POLICY.inbox.backgroundRevalidateMinMs)).toBe(false);
    });

    it("allows background revalidate after the min interval", () => {
        const old = new Date(Date.now() - CACHE_POLICY.inbox.backgroundRevalidateMinMs - 1).toISOString();
        expect(shouldBackgroundRevalidate(old, CACHE_POLICY.inbox.backgroundRevalidateMinMs)).toBe(true);
    });
});
