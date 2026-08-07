import { describe, expect, it } from "vitest";

import { sanitizeOAuthReturnTo } from "#/lib/github/oauth-return-to.server.ts";

describe("sanitizeOAuthReturnTo", () => {
    it("keeps a safe in-app path with search and hash", () => {
        expect(sanitizeOAuthReturnTo("/pr/acme/api/42?tab=files#review")).toBe("/pr/acme/api/42?tab=files#review");
    });

    it("rejects open redirects and API routes", () => {
        expect(sanitizeOAuthReturnTo("https://evil.test/phish")).toBe("/");
        expect(sanitizeOAuthReturnTo("//evil.test/phish")).toBe("/");
        expect(sanitizeOAuthReturnTo("/api/auth/github")).toBe("/");
    });

    it("defaults missing values to the inbox", () => {
        expect(sanitizeOAuthReturnTo(null)).toBe("/");
        expect(sanitizeOAuthReturnTo("   ")).toBe("/");
    });
});
