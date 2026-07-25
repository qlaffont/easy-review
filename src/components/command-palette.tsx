import { useEffect, useState } from "react";

import { useActionsBridge } from "#/components/actions/actions-provider.tsx";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "#/components/ui/command.tsx";
import { availableActions } from "#/lib/actions/catalog.ts";

const GROUPS = ["Navigation", "Inbox", "Clipboard", "Pull request"] as const;

export function CommandPalette() {
    const bridge = useActionsBridge();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((value) => !value);
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const context = bridge.buildContext();
    const actions = availableActions(context);

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title="Command palette"
            description="Run an Easy Review action"
        >
            <CommandInput placeholder="Type a command…" />
            <CommandList>
                <CommandEmpty>No matching actions.</CommandEmpty>
                {GROUPS.map((group, index) => {
                    const items = actions.filter((action) => action.group === group);
                    if (items.length === 0) {
                        return null;
                    }

                    return (
                        <div key={group}>
                            {index > 0 ? <CommandSeparator /> : null}
                            <CommandGroup heading={group}>
                                {items.map((action) => (
                                    <CommandItem
                                        key={action.id}
                                        value={`${action.label} ${action.keywords?.join(" ") ?? ""} ${action.id}`}
                                        onSelect={() => {
                                            setOpen(false);
                                            void action.run(bridge.buildContext());
                                        }}
                                    >
                                        {action.label}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </div>
                    );
                })}
            </CommandList>
        </CommandDialog>
    );
}
