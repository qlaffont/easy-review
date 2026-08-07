import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { createContext, use, useEffect, useState } from "react";

import type { EasyReviewSession, SessionState } from "#/lib/session/session.ts";

import { createBrowserStore } from "#/lib/session/adapters/browser-store.ts";
import { createGithubHttpClient, GITHUB_SESSION_CREDENTIAL } from "#/lib/session/adapters/github-http-client.ts";
import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createSeededGithub, DEV_TOKEN } from "#/lib/session/testing/dev-github.ts";

const SessionContext = createContext<EasyReviewSession | null>(null);

/** `VITE_FAKE_GITHUB=1 pnpm dev` swaps GitHub for fixtures. Folded away in a build. */
const useFixtures = import.meta.env.DEV && import.meta.env.VITE_FAKE_GITHUB === "1";

async function logoutOAuthSession(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

function beginOAuthLogin(): void {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const url = new URL("/api/auth/github", window.location.origin);
    url.searchParams.set("returnTo", returnTo);
    window.location.assign(url.toString());
}

function createSession(queryClient: ReturnType<typeof useQueryClient>): EasyReviewSession {
    return createEasyReviewSession({
        github: useFixtures
            ? createSeededGithub()
            : createGithubHttpClient(globalThis.fetch, {
                  restBaseUrl: "/api/github",
                  graphqlUrl: "/api/github/graphql",
                  credentials: "include",
              }),
        queryClient,
        store: createBrowserStore(),
        oauth: useFixtures
            ? undefined
            : {
                  sessionCredential: GITHUB_SESSION_CREDENTIAL,
                  logout: logoutOAuthSession,
                  beginLogin: beginOAuthLogin,
              },
    });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const [session] = useState(() => createSession(queryClient));

    useEffect(() => {
        if (useFixtures) {
            void session.connect(DEV_TOKEN);
            return;
        }

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

/** Null outside `SessionProvider` — for markdown embeds that also render in unit tests. */
export function useOptionalSession(): EasyReviewSession | null {
    return use(SessionContext);
}

export function useSessionState<TSelected>(selector: (state: SessionState) => TSelected): TSelected {
    return useSelector(useSession().state, selector);
}
