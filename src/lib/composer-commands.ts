import { insertBlock, wrapSelection, type MarkdownEditResult } from "#/lib/markdown-edit.ts";

export type ComposerTrigger =
    | { type: "slash"; query: string; start: number; end: number }
    | { type: "mention"; query: string; start: number; end: number };

export type SlashCommand = {
    id: string;
    label: string;
    description: string;
    /** Shown in the menu, e.g. `/code`. */
    slash: string;
    apply: (value: string, start: number, end: number) => MarkdownEditResult;
};

function replaceTrigger(
    value: string,
    triggerStart: number,
    triggerEnd: number,
    insert: string,
    selectionStart: number,
    selectionEnd: number,
): MarkdownEditResult {
    return {
        value: value.slice(0, triggerStart) + insert + value.slice(triggerEnd),
        selectionStart,
        selectionEnd,
    };
}

/** Slash commands available in comment composers (GitHub-style inserts). */
export const SLASH_COMMANDS: Array<SlashCommand> = [
    {
        id: "code",
        slash: "/code",
        label: "Code",
        description: "Insert a fenced code block",
        apply: (value, start, end) => wrapSelection(value, start, end, "```\n", "\n```", "code"),
    },
    {
        id: "suggestion",
        slash: "/suggestion",
        label: "Suggestion",
        description: "Propose a change the author can apply",
        apply: (value, start, end) => wrapSelection(value, start, end, "```suggestion\n", "\n```", "replacement"),
    },
    {
        id: "details",
        slash: "/details",
        label: "Details",
        description: "Collapsible details block",
        apply: (value, start, end) =>
            insertBlock(
                value,
                start,
                end,
                ["<details>", "<summary>Details</summary>", "", "Hidden content", "", "</details>"].join("\n"),
            ),
    },
    {
        id: "table",
        slash: "/table",
        label: "Table",
        description: "Insert a markdown table",
        apply: (value, start, end) =>
            insertBlock(value, start, end, ["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"].join("\n")),
    },
    {
        id: "task",
        slash: "/task",
        label: "Task list",
        description: "Insert a checklist item",
        apply: (value, start, end) => {
            const selected = value.slice(start, end);
            const line = selected.length > 0 ? selected : "task";
            return insertBlock(value, start, end, `- [ ] ${line}`);
        },
    },
    {
        id: "quote",
        slash: "/quote",
        label: "Quote",
        description: "Insert a blockquote",
        apply: (value, start, end) => wrapSelection(value, start, end, "> ", "", "quote"),
    },
    {
        id: "note",
        slash: "/note",
        label: "Note",
        description: "GitHub note alert",
        apply: (value, start, end) => insertBlock(value, start, end, ["> [!NOTE]", "> Useful information"].join("\n")),
    },
    {
        id: "warning",
        slash: "/warning",
        label: "Warning",
        description: "GitHub warning alert",
        apply: (value, start, end) => insertBlock(value, start, end, ["> [!WARNING]", "> Be careful"].join("\n")),
    },
    {
        id: "tip",
        slash: "/tip",
        label: "Tip",
        description: "GitHub tip alert",
        apply: (value, start, end) => insertBlock(value, start, end, ["> [!TIP]", "> Helpful advice"].join("\n")),
    },
    {
        id: "shrug",
        slash: "/shrug",
        label: "Shrug",
        description: "Insert ¯\\_(ツ)_/¯",
        apply: (value, start, end) => {
            const insert = "¯\\_(ツ)_/¯";
            return replaceTrigger(value, start, end, insert, start + insert.length, start + insert.length);
        },
    },
    {
        id: "tableflip",
        slash: "/tableflip",
        label: "Table flip",
        description: "Insert (╯°□°)╯︵ ┻━┻",
        apply: (value, start, end) => {
            const insert = "(╯°□°)╯︵ ┻━┻";
            return replaceTrigger(value, start, end, insert, start + insert.length, start + insert.length);
        },
    },
];

/**
 * Detect an active `/query` or `@query` token ending at the caret.
 * Triggers only after start-of-text, whitespace, or `(` so emails/paths don't fire.
 */
export function getComposerTrigger(value: string, caret: number): ComposerTrigger | null {
    const end = Math.max(0, Math.min(caret, value.length));
    const before = value.slice(0, end);
    const match = before.match(/(^|[\s([{])([@/])([\w./+-]*)$/);
    if (!match) {
        return null;
    }

    const marker = match[2] as "@" | "/";
    const query = match[3] ?? "";
    const start = end - query.length - 1;

    if (marker === "@") {
        return { type: "mention", query, start, end };
    }

    return { type: "slash", query, start, end };
}

export function filterSlashCommands(query: string): Array<SlashCommand> {
    const needle = query.trim().toLowerCase().replace(/^\//, "");
    if (!needle) {
        return SLASH_COMMANDS;
    }

    return SLASH_COMMANDS.filter(
        (command) =>
            command.id.includes(needle) ||
            command.label.toLowerCase().includes(needle) ||
            command.slash.slice(1).startsWith(needle),
    );
}

export function applySlashCommand(
    value: string,
    trigger: Extract<ComposerTrigger, { type: "slash" }>,
    command: SlashCommand,
): MarkdownEditResult {
    // Drop the `/query` token, then run the insert at that caret.
    const without = value.slice(0, trigger.start) + value.slice(trigger.end);
    const caret = trigger.start;
    return command.apply(without, caret, caret);
}

export function applyMention(
    value: string,
    trigger: Extract<ComposerTrigger, { type: "mention" }>,
    login: string,
): MarkdownEditResult {
    const insert = `@${login} `;
    return replaceTrigger(
        value,
        trigger.start,
        trigger.end,
        insert,
        trigger.start + insert.length,
        trigger.start + insert.length,
    );
}

/** PR participants to seed `@` autocomplete before repository assignees load. */
export function mentionCandidatesFromPullRequest(
    detail:
        | {
              author: string;
              authorAvatarUrl: string | null;
              reviewers: Array<{ login: string }>;
              assignees: Array<string>;
              reviewRequests: Array<string>;
          }
        | null
        | undefined,
): Array<{ login: string; avatarUrl?: string | null }> {
    if (!detail) {
        return [];
    }

    const seen = new Set<string>();
    const out: Array<{ login: string; avatarUrl?: string | null }> = [];

    function add(login: string, avatarUrl?: string | null) {
        const key = login.trim().toLowerCase();
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push({ login: login.trim(), avatarUrl: avatarUrl ?? null });
    }

    add(detail.author, detail.authorAvatarUrl);
    for (const reviewer of detail.reviewers) {
        add(reviewer.login);
    }
    for (const assignee of detail.assignees) {
        add(assignee);
    }
    for (const request of detail.reviewRequests) {
        add(request);
    }

    return out;
}

export function filterMentionLogins<T extends { login: string; name?: string | null }>(
    users: Array<T>,
    query: string,
): Array<T> {
    const needle = query.trim().toLowerCase();
    const seen = new Set<string>();
    const ranked: Array<{ user: T; score: number }> = [];

    for (const user of users) {
        const login = user.login.trim();
        if (!login || seen.has(login.toLowerCase())) {
            continue;
        }
        seen.add(login.toLowerCase());

        const loginLower = login.toLowerCase();
        const nameLower = user.name?.toLowerCase() ?? "";
        if (!needle) {
            ranked.push({ user, score: 0 });
            continue;
        }
        if (loginLower.startsWith(needle)) {
            ranked.push({ user, score: 0 });
        } else if (loginLower.includes(needle)) {
            ranked.push({ user, score: 1 });
        } else if (nameLower.includes(needle)) {
            ranked.push({ user, score: 2 });
        }
    }

    return [...ranked]
        .sort((a, b) => a.score - b.score || a.user.login.localeCompare(b.user.login))
        .slice(0, 8)
        .map(({ user }) => user);
}
