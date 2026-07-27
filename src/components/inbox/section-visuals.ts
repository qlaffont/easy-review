import type { LucideIcon } from "lucide-react";

import { CheckCircle2, Eye, GitMerge, GitPullRequestDraft, Hourglass, Inbox, Undo2, Users } from "lucide-react";

import type { InboxSectionId } from "#/lib/session/inbox-sections.ts";

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
};

/** Semantic color + icon per triage bucket — scannable without competing with row content. */
export const SECTION_VISUALS: Record<InboxSectionId, SectionVisual> = {
    "needs-your-review": {
        icon: Eye,
        iconClass: "text-amber-700 dark:text-amber-300",
        chipClass: "bg-amber-500/15",
        headerClass: "bg-amber-500/7 hover:bg-amber-500/12",
        countClass: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
        accentClass: "border-l-amber-500",
    },
    "returned-to-you": {
        icon: Undo2,
        iconClass: "text-rose-700 dark:text-rose-300",
        chipClass: "bg-rose-500/15",
        headerClass: "bg-rose-500/7 hover:bg-rose-500/12",
        countClass: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
        accentClass: "border-l-rose-500",
    },
    approved: {
        icon: CheckCircle2,
        iconClass: "text-emerald-700 dark:text-emerald-300",
        chipClass: "bg-emerald-500/15",
        headerClass: "bg-emerald-500/7 hover:bg-emerald-500/12",
        countClass: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
        accentClass: "border-l-emerald-500",
    },
    "waiting-for-reviewers": {
        icon: Users,
        iconClass: "text-sky-700 dark:text-sky-300",
        chipClass: "bg-sky-500/15",
        headerClass: "bg-sky-500/7 hover:bg-sky-500/12",
        countClass: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
        accentClass: "border-l-sky-500",
    },
    drafts: {
        icon: GitPullRequestDraft,
        iconClass: "text-slate-600 dark:text-slate-300",
        chipClass: "bg-slate-500/15",
        headerClass: "bg-slate-500/7 hover:bg-slate-500/12",
        countClass: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
        accentClass: "border-l-slate-400 dark:border-l-slate-500",
    },
    "merging-and-recently-merged": {
        icon: GitMerge,
        iconClass: "text-violet-700 dark:text-violet-300",
        chipClass: "bg-violet-500/15",
        headerClass: "bg-violet-500/7 hover:bg-violet-500/12",
        countClass: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
        accentClass: "border-l-violet-500",
    },
    "waiting-for-author": {
        icon: Hourglass,
        iconClass: "text-teal-700 dark:text-teal-300",
        chipClass: "bg-teal-500/15",
        headerClass: "bg-teal-500/7 hover:bg-teal-500/12",
        countClass: "bg-teal-500/15 text-teal-800 dark:text-teal-200",
        accentClass: "border-l-teal-500",
    },
    other: {
        icon: Inbox,
        iconClass: "text-muted-foreground",
        chipClass: "bg-muted",
        headerClass: "bg-muted/50 hover:bg-muted",
        countClass: "bg-muted text-muted-foreground",
        accentClass: "border-l-border",
    },
};
