import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

import {
    AlertCircle,
    Archive,
    Bell,
    Bookmark,
    Bug,
    CheckCircle2,
    Circle,
    Clock,
    Code2,
    Coffee,
    Eye,
    FileCode2,
    Filter,
    Flame,
    Flag,
    FolderGit2,
    GitBranch,
    GitCommitHorizontal,
    GitMerge,
    GitPullRequest,
    GitPullRequestDraft,
    Heart,
    Hourglass,
    Inbox,
    Layers,
    List,
    Lock,
    MessageCircle,
    MessagesSquare,
    Package,
    Pin,
    RefreshCw,
    Rocket,
    Search,
    Send,
    Shield,
    Sparkles,
    Star,
    Target,
    ThumbsDown,
    ThumbsUp,
    Timer,
    Undo2,
    User,
    UserCheck,
    Users,
    Wrench,
    Zap,
} from "lucide-react";

import type { InboxSectionId, SectionColorId, SectionIconId } from "#/lib/session/inbox-sections.ts";

import { DEFAULT_SECTION_APPEARANCE, normalizeHexColor } from "#/lib/session/inbox-sections.ts";

export type SectionVisual = {
    icon: LucideIcon;
    /** Icon color inside the chip. */
    iconClass: string;
    /** Soft chip behind the section icon. */
    chipClass: string;
    /** Section header background (includes hover). */
    headerClass: string;
    /** Count pill when the section has items. */
    countClass: string;
    /** Left accent on the section panel. */
    accentClass: string;
    /** Solid swatch for the color picker. */
    swatchClass: string;
    /** Inline tones when a custom hex color is active. */
    tones?: {
        accent?: CSSProperties;
        header?: CSSProperties;
        chip?: CSSProperties;
        icon?: CSSProperties;
        count?: CSSProperties;
        swatch?: CSSProperties;
    };
};

type SectionColorStyle = Omit<SectionVisual, "icon">;

export const SECTION_COLOR_STYLES: Record<SectionColorId, SectionColorStyle> = {
    amber: {
        iconClass: "text-amber-700 dark:text-amber-300",
        chipClass: "bg-amber-500/15",
        headerClass: "bg-amber-500/7 hover:bg-amber-500/12",
        countClass: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
        accentClass: "border-l-amber-500",
        swatchClass: "bg-amber-500",
    },
    rose: {
        iconClass: "text-rose-700 dark:text-rose-300",
        chipClass: "bg-rose-500/15",
        headerClass: "bg-rose-500/7 hover:bg-rose-500/12",
        countClass: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
        accentClass: "border-l-rose-500",
        swatchClass: "bg-rose-500",
    },
    emerald: {
        iconClass: "text-emerald-700 dark:text-emerald-300",
        chipClass: "bg-emerald-500/15",
        headerClass: "bg-emerald-500/7 hover:bg-emerald-500/12",
        countClass: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
        accentClass: "border-l-emerald-500",
        swatchClass: "bg-emerald-500",
    },
    sky: {
        iconClass: "text-sky-700 dark:text-sky-300",
        chipClass: "bg-sky-500/15",
        headerClass: "bg-sky-500/7 hover:bg-sky-500/12",
        countClass: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
        accentClass: "border-l-sky-500",
        swatchClass: "bg-sky-500",
    },
    slate: {
        iconClass: "text-slate-600 dark:text-slate-300",
        chipClass: "bg-slate-500/15",
        headerClass: "bg-slate-500/7 hover:bg-slate-500/12",
        countClass: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
        accentClass: "border-l-slate-400 dark:border-l-slate-500",
        swatchClass: "bg-slate-500",
    },
    violet: {
        iconClass: "text-violet-700 dark:text-violet-300",
        chipClass: "bg-violet-500/15",
        headerClass: "bg-violet-500/7 hover:bg-violet-500/12",
        countClass: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
        accentClass: "border-l-violet-500",
        swatchClass: "bg-violet-500",
    },
    teal: {
        iconClass: "text-teal-700 dark:text-teal-300",
        chipClass: "bg-teal-500/15",
        headerClass: "bg-teal-500/7 hover:bg-teal-500/12",
        countClass: "bg-teal-500/15 text-teal-800 dark:text-teal-200",
        accentClass: "border-l-teal-500",
        swatchClass: "bg-teal-500",
    },
    muted: {
        iconClass: "text-muted-foreground",
        chipClass: "bg-muted",
        headerClass: "bg-muted/50 hover:bg-muted",
        countClass: "bg-muted text-muted-foreground",
        accentClass: "border-l-border",
        swatchClass: "bg-muted-foreground/50",
    },
};

export const SECTION_ICONS: Record<SectionIconId, LucideIcon> = {
    eye: Eye,
    undo: Undo2,
    check: CheckCircle2,
    users: Users,
    draft: GitPullRequestDraft,
    merge: GitMerge,
    hourglass: Hourglass,
    inbox: Inbox,
    alert: AlertCircle,
    star: Star,
    bookmark: Bookmark,
    flame: Flame,
    zap: Zap,
    circle: Circle,
    folder: FolderGit2,
    "git-branch": GitBranch,
    "git-pull-request": GitPullRequest,
    "git-commit": GitCommitHorizontal,
    message: MessageCircle,
    messages: MessagesSquare,
    clock: Clock,
    timer: Timer,
    "thumbs-up": ThumbsUp,
    "thumbs-down": ThumbsDown,
    flag: Flag,
    pin: Pin,
    heart: Heart,
    sparkles: Sparkles,
    search: Search,
    filter: Filter,
    list: List,
    layers: Layers,
    archive: Archive,
    package: Package,
    rocket: Rocket,
    target: Target,
    bell: Bell,
    shield: Shield,
    lock: Lock,
    user: User,
    "user-check": UserCheck,
    refresh: RefreshCw,
    send: Send,
    bug: Bug,
    wrench: Wrench,
    "file-code": FileCode2,
    code: Code2,
    coffee: Coffee,
};

function tonesFromHex(hex: string): NonNullable<SectionVisual["tones"]> {
    return {
        accent: { borderLeftColor: hex },
        header: { backgroundColor: `color-mix(in oklab, ${hex} 10%, transparent)` },
        chip: { backgroundColor: `color-mix(in oklab, ${hex} 18%, transparent)` },
        icon: { color: hex },
        count: {
            backgroundColor: `color-mix(in oklab, ${hex} 18%, transparent)`,
            color: hex,
        },
        swatch: { backgroundColor: hex },
    };
}

export function resolveSectionVisual(
    color: SectionColorId,
    icon: SectionIconId,
    customColor?: string | null,
): SectionVisual {
    const hex = normalizeHexColor(customColor);
    const base = {
        ...SECTION_COLOR_STYLES[color],
        icon: SECTION_ICONS[icon],
    };

    if (!hex) {
        return base;
    }

    return {
        ...base,
        iconClass: "",
        chipClass: "",
        headerClass: "hover:brightness-[0.98] dark:hover:brightness-110",
        countClass: "",
        accentClass: "",
        swatchClass: "",
        tones: tonesFromHex(hex),
    };
}

export function visualForSection(
    id: InboxSectionId,
    appearance?: { color?: SectionColorId; customColor?: string | null; icon?: SectionIconId },
): SectionVisual {
    const defaults = DEFAULT_SECTION_APPEARANCE[id];
    return resolveSectionVisual(
        appearance?.color ?? defaults.color,
        appearance?.icon ?? defaults.icon,
        appearance?.customColor,
    );
}
