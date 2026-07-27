import { useEffect, useState } from "react";

import type { SuggestionChange } from "#/lib/session/apply-suggestion.ts";

export type BatchedSuggestion = SuggestionChange & {
    id: string;
    repository: string;
    number: number;
};

function pullRequestKey(repository: string, number: number): string {
    return `${repository}#${number}`;
}

export function suggestionBatchId(
    change: Pick<SuggestionChange, "path" | "startLine" | "endLine" | "replacement">,
): string {
    return `${change.path}:${change.startLine}-${change.endLine}:${change.replacement}`;
}

type BatchListener = () => void;

const batchByPullRequest = new Map<string, Array<BatchedSuggestion>>();
const listeners = new Set<BatchListener>();

function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

function getBatch(repository: string, number: number): Array<BatchedSuggestion> {
    return batchByPullRequest.get(pullRequestKey(repository, number)) ?? [];
}

export function addSuggestionToBatch(item: BatchedSuggestion): void {
    const key = pullRequestKey(item.repository, item.number);
    const current = batchByPullRequest.get(key) ?? [];
    if (current.some((row) => row.id === item.id)) {
        return;
    }
    batchByPullRequest.set(key, [...current, item]);
    notify();
}

export function removeSuggestionFromBatch(repository: string, number: number, id: string): void {
    const key = pullRequestKey(repository, number);
    const current = batchByPullRequest.get(key) ?? [];
    const next = current.filter((row) => row.id !== id);
    if (next.length === current.length) {
        return;
    }
    if (next.length === 0) {
        batchByPullRequest.delete(key);
    } else {
        batchByPullRequest.set(key, next);
    }
    notify();
}

export function clearSuggestionBatch(repository: string, number: number): void {
    const key = pullRequestKey(repository, number);
    if (!batchByPullRequest.has(key)) {
        return;
    }
    batchByPullRequest.delete(key);
    notify();
}

export function useSuggestionBatch(repository: string, number: number) {
    const [items, setItems] = useState(() => getBatch(repository, number));

    useEffect(() => {
        const sync = () => setItems(getBatch(repository, number));
        sync();
        listeners.add(sync);
        return () => {
            listeners.delete(sync);
        };
    }, [repository, number]);

    return {
        items,
        isBatched(id: string) {
            return items.some((row) => row.id === id);
        },
        add: addSuggestionToBatch,
        remove: (id: string) => removeSuggestionFromBatch(repository, number, id),
        clear: () => clearSuggestionBatch(repository, number),
    };
}
