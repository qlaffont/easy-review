import { FileDiff, Inbox, LogOut, Settings2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { RepoPickerTrigger } from "#/components/repos/repo-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { LazyChunkFallback } from "#/components/ui/loading.tsx";
import { useSession, useSessionState } from "#/lib/session/provider.tsx";
import { notifySuccess } from "#/lib/toast.ts";

const SectionLayoutEditor = lazy(() =>
    import("#/components/inbox/section-layout-editor.tsx").then((module) => ({ default: module.SectionLayoutEditor })),
);

const PrSettingsEditor = lazy(() =>
    import("#/components/pr/pr-settings-editor.tsx").then((module) => ({ default: module.PrSettingsEditor })),
);

function preloadInboxSettings() {
    void import("#/components/inbox/section-layout-editor.tsx");
}

function preloadPrSettings() {
    void import("#/components/pr/pr-settings-editor.tsx");
}

export function AppHeader() {
    const session = useSession();
    const viewer = useSessionState((state) => state.auth.viewer);
    const [inboxSettingsOpen, setInboxSettingsOpen] = useState(false);
    const [prSettingsOpen, setPrSettingsOpen] = useState(false);

    return (
        <header className="flex h-12 items-center justify-between gap-4 bg-background px-4">
            <div className="flex items-center gap-3">
                <span className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-md border border-sky-500/35 bg-sky-500/15 text-sky-700 dark:border-sky-400/40 dark:text-sky-300">
                        <Inbox className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold tracking-tight">Easy Review</span>
                </span>
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
                    <DropdownMenuItem
                        onSelect={() => setInboxSettingsOpen(true)}
                        onPointerEnter={preloadInboxSettings}
                        onFocus={preloadInboxSettings}
                    >
                        <Settings2 aria-hidden="true" />
                        Inbox Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => setPrSettingsOpen(true)}
                        onPointerEnter={preloadPrSettings}
                        onFocus={preloadPrSettings}
                    >
                        <FileDiff aria-hidden="true" />
                        PR Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                            void session.disconnect().then(() => notifySuccess("Disconnected — session cleared"));
                        }}
                    >
                        <LogOut aria-hidden="true" />
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {inboxSettingsOpen ? (
                <Suspense fallback={<LazyChunkFallback label="Loading inbox settings…" />}>
                    <SectionLayoutEditor open={inboxSettingsOpen} onOpenChange={setInboxSettingsOpen} />
                </Suspense>
            ) : null}
            {prSettingsOpen ? (
                <Suspense fallback={<LazyChunkFallback label="Loading PR settings…" />}>
                    <PrSettingsEditor open={prSettingsOpen} onOpenChange={setPrSettingsOpen} />
                </Suspense>
            ) : null}
        </header>
    );
}
