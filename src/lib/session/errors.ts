export type SessionErrorKind = "unauthorized" | "forbidden" | "rate-limited" | "not-found" | "network" | "unknown";

export type SessionError = {
    kind: SessionErrorKind;
    /** Message written for the person using Easy Review, not for a log file. */
    message: string;
    /** ISO timestamp at which a rate-limited request may be retried. */
    retryAt?: string;
};

export class EasyReviewError extends Error {
    readonly kind: SessionErrorKind;
    readonly retryAt?: string;

    constructor(kind: SessionErrorKind, message: string, options?: { retryAt?: string; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = "EasyReviewError";
        this.kind = kind;
        this.retryAt = options?.retryAt;
    }
}

export function unauthorized(
    message = "GitHub rejected this session. Sign in again, or check that the OAuth app still has access.",
): EasyReviewError {
    return new EasyReviewError("unauthorized", message);
}

export function missingToken(): EasyReviewError {
    return new EasyReviewError("unauthorized", "Sign in with GitHub before running this action.");
}

export function toSessionError(error: unknown): SessionError {
    if (error instanceof EasyReviewError) {
        return { kind: error.kind, message: error.message, retryAt: error.retryAt };
    }

    if (error instanceof Error) {
        return { kind: "unknown", message: error.message };
    }

    return { kind: "unknown", message: "Something went wrong while talking to GitHub." };
}
