import { toast } from "sonner";

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

const INBOX_PROMPT_DESCRIPTION = "Pick up the next pull request in your inbox.";
const INBOX_PROMPT_ACTION_LABEL = "Go to Inbox";
const INBOX_PROMPT_DURATION_MS = 10_000;

/** Run an action and show loading → success / error toasts. */
export async function notifyAction<T>(
    action: () => Promise<T>,
    messages: {
        loading: string;
        success: string;
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
        if (options.returnToInbox) {
            toast.success(messages.success);
            options.onGoToInbox();
        } else {
            toast.success(messages.success, {
                description: INBOX_PROMPT_DESCRIPTION,
                action: {
                    label: INBOX_PROMPT_ACTION_LABEL,
                    onClick: options.onGoToInbox,
                },
                duration: INBOX_PROMPT_DURATION_MS,
            });
        }
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
 */
export function notifyBackgroundActionWithInboxPrompt<T>(
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
    if (options.returnToInbox) {
        options.onGoToInbox();
        return notifyAction(action, messages);
    }

    return notifyActionWithInboxPrompt(action, messages, {
        returnToInbox: false,
        onGoToInbox: options.onGoToInbox,
    });
}

export function notifySuccess(message: string): void {
    toast.success(message);
}

export function notifyError(message: string): void {
    toast.error(message);
}

export function notifyCopied(label: string): void {
    toast.success(`Copied ${label}`);
}
