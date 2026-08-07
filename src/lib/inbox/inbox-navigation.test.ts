import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetInboxPreferencesCache } from "#/lib/inbox-preferences.ts";
import { openInboxPullRequest } from "#/lib/inbox/inbox-navigation.ts";

const memory = new Map<string, string>();

const localStorageMock = {
    getItem(key: string) {
        return memory.has(key) ? memory.get(key)! : null;
    },
    setItem(key: string, value: string) {
        memory.set(key, value);
    },
    removeItem(key: string) {
        memory.delete(key);
    },
};

Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
});

Object.defineProperty(globalThis, "window", {
    value: { ...globalThis, open: vi.fn() },
    configurable: true,
});

describe("openInboxPullRequest", () => {
    beforeEach(() => {
        memory.clear();
        resetInboxPreferencesCache();
        vi.mocked(window.open).mockReset();
        vi.mocked(window.open).mockImplementation(() => null);
    });

    afterEach(() => {
        memory.clear();
    });

    it("opens GitHub in a new tab by default", () => {
        const navigate = vi.fn();

        openInboxPullRequest(
            { repository: "acme/app", number: 42, url: "https://github.com/acme/app/pull/42" },
            navigate,
        );

        expect(window.open).toHaveBeenCalledWith(
            "https://github.com/acme/app/pull/42",
            "_blank",
            "noopener,noreferrer",
        );
        expect(navigate).not.toHaveBeenCalled();
    });

    it("navigates in-app when Easy Review is enabled", () => {
        localStorage.setItem(
            "easy-review:inbox-prefs:v1",
            JSON.stringify({ backgroundNotifications: false, openInEasyReview: true }),
        );
        const navigate = vi.fn();

        openInboxPullRequest(
            { repository: "acme/app", number: 42, url: "https://github.com/acme/app/pull/42" },
            navigate,
        );

        expect(navigate).toHaveBeenCalledWith("acme/app", 42);
        expect(window.open).not.toHaveBeenCalled();
    });
});
