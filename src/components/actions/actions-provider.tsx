import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useEffect, useState } from "react";

import type { ActionContext, ActionTarget } from "#/lib/actions/catalog.ts";

import { useOpenRepoPicker } from "#/components/repos/repo-picker.tsx";
import { useSession } from "#/lib/session/provider.tsx";
import { notifyCopied, notifyError } from "#/lib/toast.ts";

type ActionsBridge = {
    target: ActionTarget | null;
    setTarget: (target: ActionTarget | null) => void;
    buildContext: () => ActionContext;
};

const ActionsContext = createContext<ActionsBridge | null>(null);

export function useActionsBridge(): ActionsBridge {
    const bridge = use(ActionsContext);
    if (!bridge) {
        throw new Error("useActionsBridge must be used inside ActionsProvider.");
    }
    return bridge;
}

/** PR pages and the Inbox push the focused target into the shared action context. */
export function useSetActionTarget(target: ActionTarget | null) {
    const { setTarget } = useActionsBridge();
    const serialized = target ? JSON.stringify(target) : null;

    useEffect(() => {
        setTarget(serialized ? (JSON.parse(serialized) as ActionTarget) : null);
        return () => {
            setTarget(null);
        };
    }, [setTarget, serialized]);
}

export function ActionsProvider({ children }: { children: React.ReactNode }) {
    const session = useSession();
    const navigate = useNavigate();
    const openRepoPicker = useOpenRepoPicker();
    const [target, setTarget] = useState<ActionTarget | null>(null);

    function openPullRequest(repository: string, number: number) {
        const [owner = "", repo = ""] = repository.split("/");
        void navigate({
            to: "/pr/$owner/$repo/$number",
            params: { owner, repo, number: String(number) },
        });
    }

    function openReviewChanges(repository: string, number: number) {
        const [owner = "", repo = ""] = repository.split("/");
        void navigate({
            to: "/pr/$owner/$repo/$number",
            params: { owner, repo, number: String(number) },
            hash: "review",
        });
    }

    const bridge: ActionsBridge = {
        target,
        setTarget,
        buildContext: (): ActionContext => ({
            session,
            target,
            openRepoPicker,
            goToInbox: () => {
                void navigate({ to: "/" });
            },
            openPullRequest,
            openReviewChanges,
            copyText: async (text) => {
                try {
                    await navigator.clipboard.writeText(text);
                    notifyCopied("to clipboard");
                } catch {
                    notifyError("Could not copy to clipboard");
                    throw new Error("Could not copy to clipboard");
                }
            },
            confirm: (message) => window.confirm(message),
        }),
    };

    return <ActionsContext value={bridge}>{children}</ActionsContext>;
}

export function targetFromSummary(pullRequest: {
    repository: string;
    number: number;
    title: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    state: ActionTarget["state"];
}): ActionTarget {
    return {
        repository: pullRequest.repository,
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        headRefName: pullRequest.headRefName,
        isDraft: pullRequest.isDraft,
        state: pullRequest.state,
    };
}
