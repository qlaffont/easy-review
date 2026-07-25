import { useSelector } from "@tanstack/react-store";
import { createContext, use, useEffect, useState } from "react";

import type { EasyReviewSession, SessionState } from "#/lib/session/session.ts";

import { createBrowserStore } from "#/lib/session/adapters/browser-store.ts";
import { createGithubHttpClient } from "#/lib/session/adapters/github-http-client.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createSeededGithub } from "#/lib/session/testing/dev-github.ts";

const SessionContext = createContext<EasyReviewSession | null>(null);

/** `VITE_FAKE_GITHUB=1 bun run dev` swaps GitHub for fixtures. Folded away in a build. */
const useFixtures = import.meta.env.DEV && import.meta.env.VITE_FAKE_GITHUB === "1";

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [session] = useState(() =>
        createEasyReviewSession({
            github: useFixtures ? createSeededGithub() : createGithubHttpClient(),
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
