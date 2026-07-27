import { KeyRound, LogOut } from "lucide-react";

import { RepoPickerTrigger } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifySuccess } from "#/lib/toast.ts";

export function AppHeader({ onReplaceToken }: { onReplaceToken: () => void }) {
    const session = useSession();
    const viewer = useSessionState((state) => state.auth.viewer);

    return (
        <header className="flex h-12 items-center justify-between gap-4 border-b bg-background px-4">
            <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tracking-tight">Easy Review</span>
                <RepoPickerTrigger />
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
                        {viewer?.avatarUrl ? (
                            <img src={viewer.avatarUrl} alt="" className="size-5 rounded-full" />
                        ) : (
                            <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold uppercase">
                                {viewer?.login.slice(0, 1)}
                            </span>
                        )}
                        {viewer?.login}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-muted-foreground font-normal">
                        Signed in with a token stored in this browser
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onReplaceToken}>
                        <KeyRound aria-hidden="true" />
                        Replace token…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                            void session.disconnect().then(() => notifySuccess("Disconnected — token cleared"));
                        }}
                    >
                        <LogOut aria-hidden="true" />
                        Disconnect and clear token
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
