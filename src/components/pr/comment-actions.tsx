import { Ellipsis, ExternalLink, FileText, Link2, MessageSquareQuote, Pencil } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { notifyCopied, notifyError } from "#/lib/toast.ts";

export function CommentActionsMenu({
    url,
    body,
    canEdit,
    onEdit,
    onQuote,
}: {
    url: string;
    body: string;
    canEdit?: boolean;
    onEdit?: () => void;
    onQuote?: () => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 text-muted-foreground"
                    aria-label="Comment actions"
                >
                    <Ellipsis className="size-3.5" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                    onSelect={() => {
                        void navigator.clipboard.writeText(url).then(
                            () => notifyCopied("link"),
                            () => notifyError("Could not copy link"),
                        );
                    }}
                >
                    <Link2 className="size-3.5" aria-hidden="true" />
                    Copy link
                </DropdownMenuItem>
                {body.trim() ? (
                    <DropdownMenuItem
                        onSelect={() => {
                            void navigator.clipboard.writeText(body).then(
                                () => notifyCopied("markdown"),
                                () => notifyError("Could not copy markdown"),
                            );
                        }}
                    >
                        <FileText className="size-3.5" aria-hidden="true" />
                        Copy markdown
                    </DropdownMenuItem>
                ) : null}
                {onQuote && body.trim() ? (
                    <DropdownMenuItem onSelect={onQuote}>
                        <MessageSquareQuote className="size-3.5" aria-hidden="true" />
                        Quote reply
                    </DropdownMenuItem>
                ) : null}
                {canEdit && onEdit ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onEdit}>
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Edit
                        </DropdownMenuItem>
                    </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        View on GitHub
                    </a>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function quoteMarkdown(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) {
        return "";
    }
    return `${trimmed
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
}
