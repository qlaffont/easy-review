import { useHotkey } from "@tanstack/react-hotkeys";
import { useRouterState } from "@tanstack/react-router";

import { useActionsBridge } from "#/components/actions/actions-provider.tsx";

const OPEN_LAYER_SELECTOR = [
    '[data-slot="dialog-content"][data-state="open"]',
    '[data-slot="alert-dialog-content"][data-state="open"]',
    '[data-slot="dropdown-menu-content"][data-state="open"]',
    '[data-slot="popover-content"][data-state="open"]',
    '[data-slot="select-content"][data-state="open"]',
].join(",");

function hasOpenLayer(): boolean {
    return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}

/** On a PR page, Escape returns to Inbox when no modal/menu/popover is open. */
export function EscapeToInboxHotkey() {
    const bridge = useActionsBridge();
    const onPullRequest = useRouterState({
        select: (state) => state.location.pathname.startsWith("/pr/"),
    });

    useHotkey(
        "Escape",
        (event) => {
            // Must not steal Escape from open layers — manager defaults would preventDefault
            // before this runs, so keep those opts off and only act when the page is clear.
            if (hasOpenLayer()) {
                return;
            }
            event.preventDefault();
            bridge.buildContext().goToInbox();
        },
        {
            enabled: onPullRequest,
            ignoreInputs: true,
            preventDefault: false,
            stopPropagation: false,
        },
    );

    return null;
}
