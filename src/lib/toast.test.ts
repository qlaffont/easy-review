import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyBackgroundActionWithInboxPrompt, notifyOptimistic } from "#/lib/toast.ts";

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
const addEventListener = vi.fn();
const removeEventListener = vi.fn();

Object.defineProperty(globalThis, "window", {
    value: { close, addEventListener, removeEventListener },
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

describe("notifyOptimistic", () => {
    const options = { error: "Could not post", pullRequest: "acme/api#1", copyText: "my comment" };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("stays quiet when the action succeeds", async () => {
        await expect(notifyOptimistic(() => Promise.resolve(), options)).resolves.toBe(true);
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.loading).not.toHaveBeenCalled();
    });

    it("raises an alert that stays, naming the pull request and the reason", async () => {
        await expect(notifyOptimistic(() => Promise.reject(new Error("Nope")), options)).resolves.toBe(false);

        expect(toast.error).toHaveBeenCalledWith(
            "Could not post",
            expect.objectContaining({
                description: "acme/api#1: Nope",
                duration: Number.POSITIVE_INFINITY,
                action: expect.objectContaining({ label: "Retry" }),
                cancel: expect.objectContaining({ label: "Copy text" }),
            }),
        );
    });

    it("retries the same action from the alert", async () => {
        const action = vi.fn(() => Promise.reject(new Error("Nope")));
        await notifyOptimistic(action, options);

        const retry = vi.mocked(toast.error).mock.calls[0]![1]?.action;
        if (!retry || typeof retry !== "object" || !("onClick" in retry)) {
            throw new Error("Expected the alert to offer Retry");
        }
        retry.onClick(undefined as never);
        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

        expect(action).toHaveBeenCalledTimes(2);
    });

    it("offers no copy when the action carries no text", async () => {
        await notifyOptimistic(() => Promise.reject(new Error("Nope")), { error: "x", pullRequest: "acme/api#1" });

        expect(vi.mocked(toast.error).mock.calls[0]![1]).toMatchObject({ cancel: undefined });
    });

    it("warns before the tab closes only while an action is in flight", async () => {
        let finish = () => {};
        const running = notifyOptimistic(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
            options,
        );
        expect(addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
        expect(removeEventListener).not.toHaveBeenCalled();

        finish();
        await running;
        expect(removeEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    });
});
