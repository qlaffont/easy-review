import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";

import { isHardPageReload } from "#/lib/query/cache-policy.ts";
import { invalidateAllQueriesOnPageReload } from "#/lib/query/invalidate.ts";
import { createAppQueryClient } from "#/lib/query/query-client.ts";

const persister = createAsyncStoragePersister({
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    key: "easy-review:query-cache",
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => createAppQueryClient());

    return (
        <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
                persister,
                maxAge: 1000 * 60 * 60 * 24,
                dehydrateOptions: {
                    shouldDehydrateQuery: (query) => {
                        const root = query.queryKey[0];
                        if (root === "inbox" || root === "repos" || root === "repository") {
                            return true;
                        }
                        return root === "pullRequest" && query.queryKey[2] === "stack";
                    },
                },
            }}
            onSuccess={() => {
                if (isHardPageReload()) {
                    invalidateAllQueriesOnPageReload(queryClient);
                }
            }}
        >
            {children}
        </PersistQueryClientProvider>
    );
}

export { createAppQueryClient };
