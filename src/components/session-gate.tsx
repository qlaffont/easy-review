import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { ActionsProvider } from "#/components/actions/actions-provider.tsx";
import { AppHeader } from "#/components/app-header.tsx";
import { ConnectTokenScreen } from "#/components/auth/connect-token-screen.tsx";
import { CommandPalette } from "#/components/command-palette.tsx";
import { RepoPickerProvider } from "#/components/repos/repo-picker.tsx";
import { BootLoadingScreen } from "#/components/ui/loading.tsx";
import { useSessionState } from "#/lib/session/provider.tsx";

const bootScreen = <BootLoadingScreen />;

/** Decides between the boot state, the token screen and the signed-in app shell. */
export function SessionGate({ children }: { children: React.ReactNode }) {
    const auth = useSessionState((state) => state.auth);
    const isInbox = useRouterState({ select: (state) => state.location.pathname === "/" });
    const [replacingToken, setReplacingToken] = useState(false);

    if (auth.status === "restoring") {
        return bootScreen;
    }

    if (!auth.viewer) {
        return <ConnectTokenScreen />;
    }

    if (replacingToken) {
        return <ConnectTokenScreen onClose={() => setReplacingToken(false)} />;
    }

    return (
        <RepoPickerProvider>
            <ActionsProvider>
                <div className="flex min-h-svh flex-col">
                    {isInbox ? <AppHeader onReplaceToken={() => setReplacingToken(true)} /> : null}
                    <main className="flex-1">{children}</main>
                </div>
                <CommandPalette />
            </ActionsProvider>
        </RepoPickerProvider>
    );
}
