import { HotkeysProvider } from "@tanstack/react-hotkeys";

import { ActionsProvider } from "#/components/actions/actions-provider.tsx";
import { ClipboardHotkeys } from "#/components/actions/clipboard-hotkeys.tsx";
import { EscapeToInboxHotkey } from "#/components/actions/escape-to-inbox.tsx";
import { RefreshPullRequestHotkey } from "#/components/actions/refresh-pull-request-hotkey.tsx";
import { AppFooter } from "#/components/app-footer.tsx";
import { AppHeader } from "#/components/app-header.tsx";
import { ConnectGithubScreen } from "#/components/auth/connect-github-screen.tsx";
import { CommandPalette } from "#/components/command-palette.tsx";
import { InboxBackgroundWatcher } from "#/components/inbox/inbox-background-watcher.tsx";
import { RepoPickerProvider } from "#/components/repos/repo-picker.tsx";
import { BootLoadingScreen } from "#/components/ui/loading.tsx";
import { useSessionState } from "#/lib/session/provider.tsx";

const bootScreen = <BootLoadingScreen />;

/** Decides between the boot state, the connect screen and the signed-in app shell. */
export function SessionGate({ children }: { children: React.ReactNode }) {
    const auth = useSessionState((state) => state.auth);

    if (auth.status === "restoring" || auth.status === "verifying") {
        return bootScreen;
    }

    if (!auth.viewer) {
        return <ConnectGithubScreen />;
    }

    return (
        <RepoPickerProvider>
            <HotkeysProvider>
                <ActionsProvider>
                    <ClipboardHotkeys>
                        <div className="flex min-h-svh flex-col">
                            <div className="sticky top-0 z-20 border-b bg-background">
                                <AppHeader />
                            </div>
                            <main className="flex-1">{children}</main>
                            <AppFooter />
                        </div>
                        <EscapeToInboxHotkey />
                        <RefreshPullRequestHotkey />
                        <CommandPalette />
                        <InboxBackgroundWatcher />
                    </ClipboardHotkeys>
                </ActionsProvider>
            </HotkeysProvider>
        </RepoPickerProvider>
    );
}
