/** Relative in-app path to restore after OAuth — must not be an open redirect. */
export function sanitizeOAuthReturnTo(value: string | null | undefined): string {
    if (!value) {
        return "/";
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
        return "/";
    }

    if (trimmed.startsWith("/api/")) {
        return "/";
    }

    return trimmed;
}
