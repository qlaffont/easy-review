import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyBackgroundActionWithInboxPrompt } from "#/lib/toast.ts";

vi.mock("sonner", () => ({
    toast: {
        loading: vi.fn(() => "toast-id"),
        dismiss: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        promise: vi.fn(),
    },
}));

const close = vi.fn();

Object.defineProperty(globalThis, "window", {
    value: { close },
    configurable: true,
});

const messages = { loading: "Submitting…", success: "Submitted", error: "Failed" };

afterEach(() => {
    close.mockClear();
});

describe("notifyBackgroundActionWithInboxPrompt closing the tab", () => {
    it("waits for the action to succeed before closing", async () => {
        let finish = () => {};
        const action = () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            });

        const submission = notifyBackgroundActionWithInboxPrompt(action, messages, {
            returnToInbox: false,
            closeTab: true,
            onGoToInbox: vi.fn(),
        });
        expect(close).not.toHaveBeenCalled();

        finish();
        await submission;
        expect(close).toHaveBeenCalledOnce();
    });

    it("keeps the tab open when the action fails", async () => {
        const submission = notifyBackgroundActionWithInboxPrompt(() => Promise.reject(new Error("Nope")), messages, {
            returnToInbox: false,
            closeTab: true,
            onGoToInbox: vi.fn(),
        });

        await expect(submission).rejects.toThrow("Nope");
        expect(close).not.toHaveBeenCalled();
    });

    it("does not navigate to the Inbox first, which would add a history entry", async () => {
        const onGoToInbox = vi.fn();

        await notifyBackgroundActionWithInboxPrompt(() => Promise.resolve(), messages, {
            returnToInbox: true,
            closeTab: true,
            onGoToInbox,
        });

        expect(onGoToInbox).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
    });

    it("leaves the tab open when closing was not asked for", async () => {
        await notifyBackgroundActionWithInboxPrompt(() => Promise.resolve(), messages, {
            returnToInbox: false,
            closeTab: false,
            onGoToInbox: vi.fn(),
        });

        expect(close).not.toHaveBeenCalled();
    });
});
