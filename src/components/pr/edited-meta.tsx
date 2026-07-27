import type { ContentEdit, ContentEditor } from "#/lib/session/types.ts";

import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { RelativeTime } from "#/components/ui/relative-time.tsx";
import { cn } from "#/lib/utils.ts";

function displayLogin(login: string): string {
    return login.replace(/\[bot\]$/i, "");
}

function BotBadge({ className }: { className?: string }) {
    return (
        <span className={cn("rounded border px-1 py-px text-[10px] font-medium text-muted-foreground", className)}>
            Bot
        </span>
    );
}

function EditorAvatar({ editor }: { editor: ContentEditor }) {
    const login = displayLogin(editor.login);
    if (editor.avatarUrl) {
        return <img src={editor.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />;
    }
    return (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            {login.slice(0, 1).toUpperCase()}
        </span>
    );
}

/** GitHub-style “· edited by … [Bot]” with an edit-history popover. */
export function EditedMeta({
    lastEditedAt,
    editor,
    editCount,
    edits,
    createdAt,
    authorLogin,
    authorAvatarUrl,
}: {
    lastEditedAt: string | null;
    editor: ContentEditor | null;
    editCount: number;
    edits: Array<ContentEdit>;
    createdAt: string;
    authorLogin: string;
    authorAvatarUrl: string | null;
}) {
    if (!lastEditedAt || !editor) {
        return null;
    }

    const editorName = displayLogin(editor.login);
    const timesLabel = editCount === 1 ? "Edited 1 time" : `Edited ${editCount} times`;

    return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
            <span aria-hidden="true">·</span>
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="cursor-pointer underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
                    >
                        edited
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 gap-0 overflow-hidden p-0 text-xs">
                    <div className="border-b px-3 py-2 font-semibold text-foreground">{timesLabel}</div>
                    <ul className="flex max-h-64 flex-col gap-0 overflow-y-auto">
                        {edits.map((edit, index) => {
                            const editEditor = edit.editor;
                            const name = editEditor ? displayLogin(editEditor.login) : "ghost";
                            return (
                                <li
                                    key={`${edit.editedAt}-${index}`}
                                    className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0"
                                >
                                    {editEditor ? (
                                        <EditorAvatar editor={editEditor} />
                                    ) : (
                                        <span className="size-5 shrink-0 rounded-full bg-muted" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1">
                                            <span className="font-medium text-foreground">{name}</span>
                                            {editEditor?.isBot ? <BotBadge /> : null}
                                        </div>
                                        <p className="text-muted-foreground">
                                            edited <RelativeTime iso={edit.editedAt} />
                                            {index === 0 ? (
                                                <span className="text-muted-foreground/80"> (most recent)</span>
                                            ) : null}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                        <li className="flex items-start gap-2 px-3 py-2">
                            <EditorAvatar
                                editor={{
                                    login: authorLogin,
                                    avatarUrl: authorAvatarUrl,
                                    isBot: /\[bot\]$/i.test(authorLogin),
                                }}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="font-medium text-foreground">{displayLogin(authorLogin)}</div>
                                <p className="text-muted-foreground">
                                    created <RelativeTime iso={createdAt} />
                                </p>
                            </div>
                        </li>
                    </ul>
                </PopoverContent>
            </Popover>
            <span>by {editorName}</span>
            {editor.isBot ? <BotBadge /> : null}
        </span>
    );
}
