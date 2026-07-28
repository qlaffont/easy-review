import { useHotkey } from "@tanstack/react-hotkeys";
import { useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

import { useActionsBridge } from "#/components/actions/actions-provider.tsx";
import { findAction } from "#/lib/actions/catalog.ts";

/**
 * On a PR page, ⌘R / Ctrl+R refreshes the pull request from GitHub instead of
 * reloading the browser tab.
 */
export function RefreshPullRequestHotkey() {
    const bridge = useActionsBridge();
    const onPullRequest = useRouterState({
        select: (state) => state.location.pathname.startsWith("/pr/"),
    });

    const refresh = useCallback(() => {
        const action = findAction("pr.refresh");
        if (!action) {
            return;
        }
        const context = bridge.buildContext();
        if (!action.when(context)) {
            return;
        }
        void action.run(context);
    }, [bridge]);

    useHotkey("Mod+R", refresh, {
        enabled: onPullRequest,
        // Browser reload fires even while typing — steal it everywhere on the PR page.
        ignoreInputs: false,
        preventDefault: true,
    });

    return null;
}
