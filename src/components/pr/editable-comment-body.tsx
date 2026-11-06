import { useState, type ComponentProps } from "react";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { useMarkdownTaskToggle } from "#/components/pr/use-markdown-task-toggle.ts";
import { Button } from "#/components/ui/button.tsx";
import { notifyOptimistic } from "#/lib/toast.ts";

type EditableCommentBodyProps = {
    body: string;
    baseUrl: string;
    repository: string;
    number: number;
    canEdit: boolean;
    onSave: (body: string) => Promise<void>;
    editing: boolean;
    onEditingChange: (editing: boolean) => void;
    markdownProps?: Omit<ComponentProps<typeof Markdown>, "source" | "baseUrl">;
};

export function EditableCommentBody({
    body,
    baseUrl,
    repository,
    number,
    canEdit,
    onSave,
    editing,
    onEditingChange,
    markdownProps,
}: EditableCommentBodyProps) {
    const [draft, setDraft] = useState(body);
    const { source, onToggleTask } = useMarkdownTaskToggle(body, onSave);

    if (editing && canEdit) {
        return (
            <MarkdownComposer
                compact
                autoFocus
                value={draft}
                onChange={setDraft}
                rows={4}
                previewBaseUrl={baseUrl}
                repository={repository}
                pullRequestNumber={number}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setDraft(body);
                                onEditingChange(false);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={!draft.trim()}
                            onClick={() => {
                                const next = draft.trim();
                                onEditingChange(false);
                                void notifyOptimistic(() => onSave(next), {
                                    error: "Could not update the comment.",
                                    pullRequest: `${repository}#${number}`,
                                    copyText: next,
                                });
                            }}
                        >
                            Save
                        </Button>
                    </div>
                }
            />
        );
    }

    return <Markdown source={source} baseUrl={baseUrl} {...markdownProps} onToggleTask={onToggleTask} />;
}
