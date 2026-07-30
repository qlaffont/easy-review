import { Clipboard } from "lucide-react";
import { useState } from "react";

import { useRegisterCopyMenu } from "#/components/actions/clipboard-hotkeys.tsx";
import { Button } from "#/components/ui/button.tsx";
import { ChordKeys } from "#/components/ui/chord-keys.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { notifyCopied, notifyError } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

function ChordHint({ keys }: { keys: Array<string> }) {
    return (
        <DropdownMenuShortcut className="tracking-normal">
            <ChordKeys keys={keys} />
        </DropdownMenuShortcut>
    );
}

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        notifyCopied("to clipboard");
    } catch {
        notifyError("Could not copy to clipboard");
    }
}

function appPullRequestUrl(repository: string, number: number): string {
    const [owner = "", repo = ""] = repository.split("/");
    const path = `/pr/${owner}/${repo}/${number}`;
    if (typeof window === "undefined") {
        return path;
    }
    return `${window.location.origin}${path}`;
}

/** Graphite-style copy menu for the open pull request. */
export function PullRequestCopyMenu({
    repository,
    number,
    title,
    githubUrl,
    headRefName,
    className,
}: {
    repository: string;
    number: number;
    title: string;
    githubUrl: string;
    headRefName: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [owner = "", repo = ""] = repository.split("/");
    const checkout = `gh pr checkout ${number} --repo ${owner}/${repo}`;

    useRegisterCopyMenu({
        open: () => {
            const scrollY = window.scrollY;
            setOpen(true);
            requestAnimationFrame(() => {
                window.scrollTo({ top: scrollY });
            });
        },
        close: () => setOpen(false),
    });

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <HelpTooltip label="Copy">
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn("size-8 shrink-0 text-muted-foreground", className)}
                        aria-label="Copy pull request details"
                    >
                        <Clipboard className="size-3.5" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
            </HelpTooltip>
            <DropdownMenuContent align="end" className="min-w-64" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => {
                        void copy(appPullRequestUrl(repository, number));
                    }}
                >
                    Copy link to PR
                    <ChordHint keys={["C", "L"]} />
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => {
                        void copy(title);
                    }}
                >
                    Copy title
                    <ChordHint keys={["C", "T"]} />
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => {
                        void copy(githubUrl);
                    }}
                >
                    Copy link to GitHub
                    <ChordHint keys={["C", "G"]} />
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => {
                        void copy(headRefName);
                    }}
                >
                    Copy PR branch name
                    <ChordHint keys={["C", "B"]} />
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => {
                        void copy(checkout);
                    }}
                >
                    Copy CLI checkout command
                    <ChordHint keys={["C", "C"]} />
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
