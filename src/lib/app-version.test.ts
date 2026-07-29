import { describe, expect, it } from "vitest";

import { isNewerAppBuild, resolveAppBuildId, wasUpdateDismissed } from "#/lib/app-version.ts";

describe("app version", () => {
    it("falls back to dev when build id is missing", () => {
        expect(resolveAppBuildId(undefined)).toBe("dev");
        expect(resolveAppBuildId("")).toBe("dev");
        expect(resolveAppBuildId("  abc  ")).toBe("abc");
    });

    it("detects a newer live build", () => {
        expect(isNewerAppBuild("aaa", "bbb")).toBe(true);
        expect(isNewerAppBuild("aaa", "aaa")).toBe(false);
        expect(isNewerAppBuild("dev", "bbb")).toBe(false);
    });

    it("remembers a dismissed live build", () => {
        expect(wasUpdateDismissed("bbb", "bbb")).toBe(true);
        expect(wasUpdateDismissed("bbb", "aaa")).toBe(false);
        expect(wasUpdateDismissed("bbb", null)).toBe(false);
    });
});
