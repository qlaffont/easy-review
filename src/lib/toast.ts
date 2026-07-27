import { toast } from "sonner";

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

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

export function notifySuccess(message: string): void {
    toast.success(message);
}

export function notifyError(message: string): void {
    toast.error(message);
}

export function notifyCopied(label: string): void {
    toast.success(`Copied ${label}`);
}
