export const THEME_STORAGE_KEY = "easy-review:theme:v1";

export const THEME_IDS = ["light", "dark", "matrix", "midnight", "paper"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeDefinition = {
    id: ThemeId;
    label: string;
    description: string;
    /** Whether `dark:` utilities and dark color-scheme should apply. */
    scheme: "light" | "dark";
    /** Swatch colors shown in the theme picker. */
    swatch: [string, string, string];
};

export const THEMES: readonly ThemeDefinition[] = [
    {
        id: "light",
        label: "Light",
        description: "Clean daylight defaults",
        scheme: "light",
        swatch: ["#ffffff", "#e4e4e7", "#18181b"],
    },
    {
        id: "dark",
        label: "Dark",
        description: "Low-glare graphite",
        scheme: "dark",
        swatch: ["#18181b", "#27272a", "#fafafa"],
    },
    {
        id: "matrix",
        label: "Matrix",
        description: "Green phosphor terminal",
        scheme: "dark",
        swatch: ["#020b05", "#0a1f10", "#33ff66"],
    },
    {
        id: "midnight",
        label: "Midnight",
        description: "Deep navy with cyan accents",
        scheme: "dark",
        swatch: ["#070b16", "#121a2e", "#7dd3fc"],
    },
    {
        id: "paper",
        label: "Paper",
        description: "Soft newsprint reading mode",
        scheme: "light",
        swatch: ["#f2f0e9", "#e4e0d4", "#1c1917"],
    },
] as const;

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value: string | undefined | null): value is ThemeId {
    return THEME_IDS.includes(value as ThemeId);
}

export function themeDefinition(id: string | undefined | null): ThemeDefinition {
    if (isThemeId(id)) {
        return THEME_BY_ID.get(id)!;
    }
    return THEME_BY_ID.get("light")!;
}

export function isDarkScheme(theme: string | undefined | null): boolean {
    return themeDefinition(theme).scheme === "dark";
}
