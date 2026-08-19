import { useState, type ComponentProps } from "react";

import { MarkdownComposer } from "#/components/pr/markdown-composer.tsx";
import { Markdown } from "#/components/pr/markdown.tsx";
import { useMarkdownTaskToggle } from "#/components/pr/use-markdown-task-toggle.ts";
import { Button } from "#/components/ui/button.tsx";
import { notifyAction } from "#/lib/toast.ts";

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
    const [saving, setSaving] = useState(false);
    const { source, onToggleTask } = useMarkdownTaskToggle(body, onSave);

    if (editing && canEdit) {
        return (
            <MarkdownComposer
                compact
                autoFocus
                value={draft}
                onChange={setDraft}
                rows={4}
                disabled={saving}
                previewBaseUrl={baseUrl}
                repository={repository}
                pullRequestNumber={number}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={saving}
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
                            disabled={saving || !draft.trim()}
                            onClick={() => {
                                setSaving(true);
                                void notifyAction(
                                    async () => {
                                        await onSave(draft.trim());
                                        onEditingChange(false);
                                    },
                                    {
                                        loading: "Saving comment…",
                                        success: "Comment updated",
                                        error: "Could not update the comment.",
                                    },
                                ).finally(() => setSaving(false));
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
