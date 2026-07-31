import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetGithubServerEnvCache } from "#/lib/github/env.server.ts";
import { openGithubSessionPayload, sealGithubSessionPayload } from "#/lib/github/token-crypto.server.ts";

describe("token-crypto.server", () => {
    beforeEach(() => {
        process.env.GITHUB_CLIENT_ID = "Iv1.testclientid000000000000000000";
        process.env.GITHUB_CLIENT_SECRET = "test-client-secret-for-crypto-tests";
        delete process.env.GITHUB_SESSION_SECRET;
        resetGithubServerEnvCache();
    });

    afterEach(() => {
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        delete process.env.GITHUB_SESSION_SECRET;
        resetGithubServerEnvCache();
    });

    it("round-trips session payloads", () => {
        const payload = JSON.stringify({
            v: 1,
            refreshToken: "ghr_test_refresh",
            accessExpiresAt: Date.now() + 28_800_000,
            refreshExpiresAt: Date.now() + 15_897_600_000,
        });

        const sealed = sealGithubSessionPayload(payload);
        expect(openGithubSessionPayload(sealed)).toBe(payload);
    });

    it("uses GITHUB_SESSION_SECRET when set", () => {
        process.env.GITHUB_SESSION_SECRET = "dedicated-session-secret-32-chars-min!!";
        resetGithubServerEnvCache();

        const payload = '{"v":1}';
        const sealed = sealGithubSessionPayload(payload);

        delete process.env.GITHUB_SESSION_SECRET;
        resetGithubServerEnvCache();

        expect(openGithubSessionPayload(sealed)).toBeNull();
    });

    it("rejects tampered ciphertext", () => {
        const sealed = sealGithubSessionPayload('{"v":1}');
        const last = sealed.at(-1)!;
        const tampered = `${sealed.slice(0, -1)}${last === "A" ? "B" : "A"}`;
        expect(openGithubSessionPayload(tampered)).toBeNull();
    });
});
