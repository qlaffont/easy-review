import { useCallback, useEffect, useState } from "react";

import { toggleMarkdownTask } from "#/lib/markdown-task-list.ts";
import { notifyError } from "#/lib/toast.ts";

/** Optimistic GitHub task-list toggles against a markdown body. */
export function useMarkdownTaskToggle(body: string, onSave: (next: string) => Promise<void>) {
    const [source, setSource] = useState(body);

    useEffect(() => {
        setSource(body);
    }, [body]);

    const onToggleTask = useCallback(
        (index: number, checked: boolean) => {
            const next = toggleMarkdownTask(source, index, checked);
            if (next == null) {
                return;
            }
            const previous = source;
            setSource(next);
            void onSave(next).catch((cause) => {
                setSource(previous);
                notifyError(cause instanceof Error ? cause.message : "Could not update the task list.");
            });
        },
        [onSave, source],
    );

    return { source, onToggleTask };
}
