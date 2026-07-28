import { useHotkey, useHotkeySequences } from "@tanstack/react-hotkeys";
import { createContext, use, useCallback, useEffect, useRef, useState } from "react";

import { useActionsBridge } from "#/components/actions/actions-provider.tsx";
import { findAction } from "#/lib/actions/catalog.ts";

type CopyMenuControls = {
    open: () => void;
    close: () => void;
};

type CopyMenuBridge = {
    register: (controls: CopyMenuControls | null) => void;
};

const CopyMenuContext = createContext<CopyMenuBridge | null>(null);

/** Lets the PR copy dropdown register so `C` can open it. */
export function useRegisterCopyMenu(controls: CopyMenuControls) {
    const bridge = use(CopyMenuContext);
    const controlsRef = useRef(controls);
    controlsRef.current = controls;

    useEffect(() => {
        if (!bridge) {
            return;
        }

        bridge.register({
            open: () => controlsRef.current.open(),
            close: () => controlsRef.current.close(),
        });

        return () => {
            bridge.register(null);
        };
    }, [bridge]);
}

/**
 * Graphite-style clipboard chords. `C` opens the copy dropdown when mounted;
 * `C` then L/T/G/B/C runs the matching copy action.
 */
export function ClipboardHotkeys({ children }: { children?: React.ReactNode }) {
    const bridge = useActionsBridge();
    const enabled = bridge.target !== null;
    const menuRef = useRef<CopyMenuControls | null>(null);

    const [copyMenuBridge] = useState<CopyMenuBridge>(() => ({
        register(controls) {
            menuRef.current = controls;
        },
    }));

    const run = useCallback(
        (actionId: string) => {
            const action = findAction(actionId);
            if (!action) {
                return;
            }
            const context = bridge.buildContext();
            if (!action.when(context)) {
                return;
            }
            void action.run(context);
            menuRef.current?.close();
        },
        [bridge],
    );

    useHotkey(
        "C",
        () => {
            menuRef.current?.open();
        },
        { enabled, preventDefault: true, ignoreInputs: true },
    );

    useHotkeySequences(
        [
            {
                sequence: ["C", "L"],
                callback: () => run("copy.pr-url"),
                options: { meta: { name: "Copy link to PR" } },
            },
            {
                sequence: ["C", "T"],
                callback: () => run("copy.pr-title"),
                options: { meta: { name: "Copy title" } },
            },
            {
                sequence: ["C", "G"],
                callback: () => run("copy.github-url"),
                options: { meta: { name: "Copy link to GitHub" } },
            },
            {
                sequence: ["C", "B"],
                callback: () => run("copy.branch"),
                options: { meta: { name: "Copy PR branch name" } },
            },
            {
                sequence: ["C", "C"],
                callback: () => run("copy.checkout"),
                options: { meta: { name: "Copy CLI checkout command" } },
            },
        ],
        { enabled, preventDefault: true, ignoreInputs: true },
    );

    return <CopyMenuContext value={copyMenuBridge}>{children}</CopyMenuContext>;
}
