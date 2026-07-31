import { describe, expect, it } from "vitest";

import { oauthTokensUseRefreshFlow } from "#/lib/github/oauth-types.ts";

describe("oauthTokensUseRefreshFlow", () => {
    it("detects expiring token responses", () => {
        expect(
            oauthTokensUseRefreshFlow({
                accessToken: "ghu_access",
                refreshToken: "ghr_refresh",
                expiresIn: 28_800,
            }),
        ).toBe(true);
    });

    it("falls back to legacy storage when refresh is omitted", () => {
        expect(oauthTokensUseRefreshFlow({ accessToken: "ghu_access" })).toBe(false);
    });
});
