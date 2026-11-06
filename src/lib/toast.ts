import { toast } from "sonner";

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

const INBOX_PROMPT_DESCRIPTION = "Pick up the next pull request in your inbox.";
const INBOX_PROMPT_ACTION_LABEL = "Go to Inbox";
const INBOX_PROMPT_DURATION_MS = 10_000;

let optimisticActionsInFlight = 0;

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
    event.preventDefault();
}

/** Closing the tab cancels requests, which would lose an action the UI already showed as done. */
async function holdTabWhile<T>(work: Promise<T>): Promise<T> {
    if (optimisticActionsInFlight === 0) {
        window.addEventListener("beforeunload", warnBeforeLeaving);
    }
    optimisticActionsInFlight += 1;
    try {
        return await work;
    } finally {
        optimisticActionsInFlight -= 1;
        if (optimisticActionsInFlight === 0) {
            window.removeEventListener("beforeunload", warnBeforeLeaving);
        }
    }
}

/**
 * Send an action the UI has already applied: stay quiet while it runs, and raise an alert that
 * stays until dismissed if GitHub refuses it. Retry re-runs the action, and `copyText` keeps text
 * the reviewer wrote from being lost when the refusal is permanent. Resolves to whether it succeeded.
 */
export async function notifyOptimistic(
    action: () => Promise<unknown>,
    options: {
        error: string;
        /** `owner/repo#123`, since the reviewer may have moved on by the time this fails. */
        pullRequest: string;
        copyText?: string;
    },
): Promise<boolean> {
    try {
        await holdTabWhile(action());
        return true;
    } catch (cause) {
        toast.error(options.error, {
            description: `${options.pullRequest}: ${errorMessage(cause, "GitHub refused the request.")}`,
            duration: Number.POSITIVE_INFINITY,
            action: {
                label: "Retry",
                onClick: () => void notifyOptimistic(action, options),
            },
            cancel: options.copyText
                ? {
                      label: "Copy text",
                      onClick: () => {
                          const text = options.copyText ?? "";
                          void navigator.clipboard.writeText(text).then(() => notifyCopied("text"));
                      },
                  }
                : undefined,
        });
        return false;
    }
}

/** Run an action and show loading → success / error toasts. */
export async function notifyAction<T>(
    action: () => Promise<T>,
    messages: {
        loading: string;
        success: string | ((value: T) => string);
        error?: string;
    },
): Promise<T> {
    const promise = action();
    void toast.promise(promise, {
        loading: messages.loading,
        success: messages.success,
        error: (cause) => errorMessage(cause, messages.error ?? "Something went wrong"),
    });
    return promise;
}

/**
 * Like {@link notifyAction}, but when `returnToInbox` is off shows a success toast with a
 * shortcut back to the inbox instead of navigating automatically.
 */
export async function notifyActionWithInboxPrompt<T>(
    action: () => Promise<T>,
    messages: {
        loading: string;
        success: string;
        error?: string;
    },
    options: {
        returnToInbox: boolean;
        onGoToInbox: () => void;
    },
): Promise<T> {
    const toastId = toast.loading(messages.loading);
    try {
        const result = await action();
        toast.dismiss(toastId);
        notifySuccessWithInboxPrompt(messages.success, options);
        return result;
    } catch (cause) {
        toast.dismiss(toastId);
        toast.error(errorMessage(cause, messages.error ?? "Something went wrong"));
        throw cause;
    }
}

/**
 * Same toasts as {@link notifyActionWithInboxPrompt}, but does not block the caller.
 * When `returnToInbox` is on, navigates immediately and lets the fetch finish in the background.
 * `closeTab` takes over from `returnToInbox`: the tab stays open until the action succeeds, because
 * closing it earlier could cancel the request and would hide a failure.
 */
export async function notifyBackgroundActionWithInboxPrompt<T>(
    action: () => Promise<T>,
    messages: {
        loading: string;
        success: string;
        error?: string;
    },
    options: {
        returnToInbox: boolean;
        closeTab: boolean;
        onGoToInbox: () => void;
    },
): Promise<T> {
    if (options.closeTab) {
        const result = await notifyActionWithInboxPrompt(action, messages, {
            returnToInbox: false,
            onGoToInbox: options.onGoToInbox,
        });
        window.close();
        return result;
    }

    if (options.returnToInbox) {
        return notifyBackgroundActionAfterNavigating(action, messages, options.onGoToInbox);
    }

    return notifyActionWithInboxPrompt(action, messages, {
        returnToInbox: false,
        onGoToInbox: options.onGoToInbox,
    });
}

/** Navigate right away and let the action finish in the background with loading → success / error toasts. */
export function notifyBackgroundActionAfterNavigating<T>(
    action: () => Promise<T>,
    messages: {
        loading: string;
        success: string;
        error?: string;
    },
    navigate: () => void,
): Promise<T> {
    navigate();
    return notifyAction(action, messages);
}

/** Go back to the Inbox when `returnToInbox` is on, otherwise offer a shortcut to it. */
export function notifySuccessWithInboxPrompt(
    message: string,
    options: { returnToInbox: boolean; onGoToInbox: () => void },
): void {
    if (options.returnToInbox) {
        toast.success(message);
        options.onGoToInbox();
        return;
    }

    toast.success(message, {
        description: INBOX_PROMPT_DESCRIPTION,
        action: {
            label: INBOX_PROMPT_ACTION_LABEL,
            onClick: options.onGoToInbox,
        },
        duration: INBOX_PROMPT_DURATION_MS,
    });
}

export function notifySuccess(message: string): void {
    toast.success(message);
}

/** `sticky` keeps the toast until dismissed, for messages the user may be away from the tab to see. */
export function notifyError(message: string, options?: { sticky?: boolean }): void {
    if (options?.sticky) {
        toast.error(message, { duration: Number.POSITIVE_INFINITY });
        return;
    }

    toast.error(message);
}

export function notifyCopied(label: string): void {
    toast.success(`Copied ${label}`);
}
