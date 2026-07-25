import { useSelector } from "@tanstack/react-store";
import { createContext, use, useEffect, useState } from "react";

import type { EasyReviewSession, SessionState } from "#/lib/session/session.ts";

import { createBrowserStore } from "#/lib/session/adapters/browser-store.ts";
import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";

const SessionContext = createContext<EasyReviewSession | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [session] = useState(() =>
        createEasyReviewSession({
            github: createGithubHttpClient(),
            store: createBrowserStore(),
        }),
    );

    useEffect(() => {
        void session.restore();
    }, [session]);

    return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): EasyReviewSession {
    const session = use(SessionContext);

    if (!session) {
        throw new Error("useSession must be used inside a SessionProvider.");
    }

    return session;
}

export function useSessionState<TSelected>(selector: (state: SessionState) => TSelected): TSelected {
    return useSelector(useSession().state, selector);
}
