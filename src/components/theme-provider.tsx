import { ThemeProvider as NextThemesProvider } from "next-themes";

import { THEME_IDS, THEME_STORAGE_KEY } from "#/lib/theme.ts";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            storageKey={THEME_STORAGE_KEY}
            themes={[...THEME_IDS]}
        >
            {children}
        </NextThemesProvider>
    );
}
