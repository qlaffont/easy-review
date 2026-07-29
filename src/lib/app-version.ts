/**
 * Build identity baked into the client + server bundle at compile time.
 * After a deploy, the old tab still has the previous id; `/api/version` returns the new one.
 */
export function resolveAppBuildId(envBuildId: string | undefined, fallback = "dev"): string {
    const trimmed = envBuildId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/** True when the live server reports a different build than this tab loaded. */
export function isNewerAppBuild(currentBuildId: string, liveBuildId: string): boolean {
    const current = currentBuildId.trim();
    const live = liveBuildId.trim();
    if (!current || !live || current === "dev") {
        return false;
    }
    return live !== current;
}

/** sessionStorage key: last live build id the user dismissed (“Later”). */
export const DISMISSED_APP_BUILD_KEY = "easy-review:app-update-dismissed";

export function wasUpdateDismissed(liveBuildId: string, stored: string | null): boolean {
    return Boolean(stored && stored === liveBuildId.trim());
}
