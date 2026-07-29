import { useEffect, useRef, useState } from "react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { DISMISSED_APP_BUILD_KEY, isNewerAppBuild, resolveAppBuildId, wasUpdateDismissed } from "#/lib/app-version.ts";

const POLL_MS = 5 * 60 * 1000;

const currentBuildId = resolveAppBuildId(import.meta.env.VITE_APP_BUILD_ID);

async function fetchLiveBuildId(): Promise<string | null> {
    try {
        const response = await fetch(`/api/version?t=${Date.now()}`, {
            method: "GET",
            cache: "no-store",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as { buildId?: unknown };
        return typeof payload.buildId === "string" ? payload.buildId : null;
    } catch {
        return null;
    }
}

function shouldPreviewUpdate(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    return new URLSearchParams(window.location.search).has("preview-update");
}

/** Polls `/api/version` and asks to reload when a newer deploy is live. */
export function AppUpdateWatcher() {
    const started = useRef(false);
    const [liveBuildId, setLiveBuildId] = useState<string | null>(null);
    const open = liveBuildId !== null;

    useEffect(() => {
        if (shouldPreviewUpdate()) {
            setLiveBuildId("preview");
            return;
        }

        if (import.meta.env.DEV || started.current) {
            return;
        }
        started.current = true;

        async function checkForAppUpdate() {
            const nextBuildId = await fetchLiveBuildId();
            if (!nextBuildId || !isNewerAppBuild(currentBuildId, nextBuildId)) {
                return;
            }

            let dismissed: string | null = null;
            try {
                dismissed = sessionStorage.getItem(DISMISSED_APP_BUILD_KEY);
            } catch {
                dismissed = null;
            }
            if (wasUpdateDismissed(nextBuildId, dismissed)) {
                return;
            }

            setLiveBuildId(nextBuildId);
        }

        void checkForAppUpdate();
        const timer = window.setInterval(() => {
            void checkForAppUpdate();
        }, POLL_MS);

        function onVisible() {
            if (document.visibilityState === "visible") {
                void checkForAppUpdate();
            }
        }
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    function dismiss() {
        if (liveBuildId) {
            try {
                sessionStorage.setItem(DISMISSED_APP_BUILD_KEY, liveBuildId);
            } catch {
                // ignore quota / private mode
            }
        }
        setLiveBuildId(null);
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    dismiss();
                }
            }}
        >
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>New version available</AlertDialogTitle>
                    <AlertDialogDescription>
                        A newer Easy Review build is live. Reload to get the latest fixes and features.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={dismiss}>Later</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            window.location.reload();
                        }}
                    >
                        Reload
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
