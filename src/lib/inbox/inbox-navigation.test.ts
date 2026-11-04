import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetInboxPreferencesCache } from "#/lib/inbox-preferences.ts";
import { openInboxPullRequest, openInboxPullRequestsInTabs } from "#/lib/inbox/inbox-navigation.ts";

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
    value: { ...globalThis, open: vi.fn(), localStorage: localStorageMock },
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
        resetInboxPreferencesCache();
        const navigate = vi.fn();

        openInboxPullRequest(
            { repository: "acme/app", number: 42, url: "https://github.com/acme/app/pull/42" },
            navigate,
        );

        expect(navigate).toHaveBeenCalledWith("acme/app", 42);
        expect(window.open).not.toHaveBeenCalled();
    });
});

describe("openInboxPullRequestsInTabs", () => {
    const pullRequests = [
        { repository: "acme/app", number: 1, url: "https://github.com/acme/app/pull/1" },
        { repository: "acme/api", number: 2, url: "https://github.com/acme/api/pull/2" },
    ];

    function stubTabs(): Array<{ opener: unknown; location: { href: string } }> {
        const tabs: Array<{ opener: unknown; location: { href: string } }> = [];
        vi.mocked(window.open).mockImplementation(() => {
            const tab = { opener: window, location: { href: "about:blank" } };
            tabs.push(tab);
            return tab as unknown as Window;
        });
        return tabs;
    }

    beforeEach(() => {
        memory.clear();
        resetInboxPreferencesCache();
        vi.mocked(window.open).mockReset();
    });

    afterEach(() => {
        memory.clear();
    });

    it("opens each pull request on GitHub in its own tab, without an opener link", () => {
        const tabs = stubTabs();

        expect(openInboxPullRequestsInTabs(pullRequests)).toEqual({ blocked: 0 });

        expect(tabs.map((tab) => tab.location.href)).toEqual([
            "https://github.com/acme/app/pull/1",
            "https://github.com/acme/api/pull/2",
        ]);
        expect(tabs.map((tab) => tab.opener)).toEqual([null, null]);
    });

    it("opens the Easy Review page when the setting is on", () => {
        localStorage.setItem(
            "easy-review:inbox-prefs:v1",
            JSON.stringify({ backgroundNotifications: false, openInEasyReview: true }),
        );
        resetInboxPreferencesCache();
        const tabs = stubTabs();

        openInboxPullRequestsInTabs(pullRequests);

        expect(tabs.map((tab) => tab.location.href)).toEqual(["/pr/acme/app/1", "/pr/acme/api/2"]);
    });

    it("counts the tabs the pop-up blocker refuses and keeps going", () => {
        const tabs = stubTabs();
        vi.mocked(window.open).mockImplementationOnce(() => null);

        expect(openInboxPullRequestsInTabs(pullRequests)).toEqual({ blocked: 1 });

        expect(tabs.map((tab) => tab.location.href)).toEqual(["https://github.com/acme/api/pull/2"]);
    });
});
