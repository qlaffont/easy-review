import { afterEach, describe, expect, it } from "vitest";

import { getGithubAppInstallUrl, getGithubServerEnv, resetGithubServerEnvCache } from "#/lib/github/env.server.ts";

const ORIGINAL_ID = process.env.GITHUB_CLIENT_ID;
const ORIGINAL_SECRET = process.env.GITHUB_CLIENT_SECRET;
const ORIGINAL_SLUG = process.env.GITHUB_APP_SLUG;

afterEach(() => {
    resetGithubServerEnvCache();
    if (ORIGINAL_ID === undefined) {
        delete process.env.GITHUB_CLIENT_ID;
    } else {
        process.env.GITHUB_CLIENT_ID = ORIGINAL_ID;
    }
    if (ORIGINAL_SECRET === undefined) {
        delete process.env.GITHUB_CLIENT_SECRET;
    } else {
        process.env.GITHUB_CLIENT_SECRET = ORIGINAL_SECRET;
    }
    if (ORIGINAL_SLUG === undefined) {
        delete process.env.GITHUB_APP_SLUG;
    } else {
        process.env.GITHUB_APP_SLUG = ORIGINAL_SLUG;
    }
});

describe("getGithubServerEnv", () => {
    it("accepts a GitHub App client id (Iv1.)", () => {
        process.env.GITHUB_CLIENT_ID = "Iv1.abcdef0123456789";
        process.env.GITHUB_CLIENT_SECRET = "secret";
        delete process.env.GITHUB_APP_SLUG;

        expect(getGithubServerEnv()).toEqual({
            GITHUB_CLIENT_ID: "Iv1.abcdef0123456789",
            GITHUB_CLIENT_SECRET: "secret",
        });
    });

    it("accepts a GitHub App client id (Iv23…)", () => {
        process.env.GITHUB_CLIENT_ID = "Iv23f8doAlphaNumer1c";
        process.env.GITHUB_CLIENT_SECRET = "secret";
        delete process.env.GITHUB_APP_SLUG;

        expect(getGithubServerEnv().GITHUB_CLIENT_ID).toBe("Iv23f8doAlphaNumer1c");
    });

    it("rejects OAuth App client ids (Ov…)", () => {
        process.env.GITHUB_CLIENT_ID = "Ov23li3Yc5pV0Gv9IWv6";
        process.env.GITHUB_CLIENT_SECRET = "secret";

        expect(() => getGithubServerEnv()).toThrow(/GitHub App/);
    });

    it("accepts an optional app slug for Install App", () => {
        process.env.GITHUB_CLIENT_ID = "Iv1.abcdef0123456789";
        process.env.GITHUB_CLIENT_SECRET = "secret";
        process.env.GITHUB_APP_SLUG = "easy-review-local";

        expect(getGithubServerEnv().GITHUB_APP_SLUG).toBe("easy-review-local");
        expect(getGithubAppInstallUrl()).toBe("https://github.com/apps/easy-review-local/installations/new");
    });

    it("returns null install URL when slug is unset", () => {
        process.env.GITHUB_CLIENT_ID = "Iv1.abcdef0123456789";
        process.env.GITHUB_CLIENT_SECRET = "secret";
        delete process.env.GITHUB_APP_SLUG;

        expect(getGithubAppInstallUrl()).toBeNull();
    });
});
