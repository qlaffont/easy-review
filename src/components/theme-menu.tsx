import { Monitor, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { THEMES } from "#/lib/theme.ts";

function ThemeSwatch({ colors }: { colors: readonly [string, string, string] }) {
    return (
        <span className="flex size-4 shrink-0 overflow-hidden rounded-sm border border-border" aria-hidden="true">
            <span className="h-full w-1/3" style={{ backgroundColor: colors[0] }} />
            <span className="h-full w-1/3" style={{ backgroundColor: colors[1] }} />
            <span className="h-full w-1/3" style={{ backgroundColor: colors[2] }} />
        </span>
    );
}

function ThemeRadioOptions({ value, onValueChange }: { value: string; onValueChange: (theme: string) => void }) {
    return (
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="system" title="Follow OS light/dark setting">
                <Monitor aria-hidden="true" />
                System
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {THEMES.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} title={item.description}>
                    <ThemeSwatch colors={item.swatch} />
                    {item.label}
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    );
}

function useMountedTheme() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return {
        value: mounted ? (theme ?? "system") : "system",
        setTheme,
    };
}

/** Nested theme picker for the account dropdown. */
export function ThemeMenuSub() {
    const { value, setTheme } = useMountedTheme();

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <Palette aria-hidden="true" />
                Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
                <ThemeRadioOptions value={value} onValueChange={setTheme} />
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

/** Standalone theme trigger for surfaces without the account menu (e.g. connect screen). */
export function ThemeMenuButton() {
    const { value, setTheme } = useMountedTheme();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Theme" className="gap-2">
                    <Palette aria-hidden="true" />
                    Theme
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
                <ThemeRadioOptions value={value} onValueChange={setTheme} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
