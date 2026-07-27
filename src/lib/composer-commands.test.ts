import { describe, expect, it } from "vitest";

import {
    applyMention,
    applySlashCommand,
    filterMentionLogins,
    filterSlashCommands,
    getComposerTrigger,
    mentionCandidatesFromPullRequest,
    SLASH_COMMANDS,
} from "#/lib/composer-commands.ts";

describe("composer-commands", () => {
    it("detects slash and mention triggers at the caret", () => {
        expect(getComposerTrigger("hello /co", 9)).toEqual({
            type: "slash",
            query: "co",
            start: 6,
            end: 9,
        });
        expect(getComposerTrigger("hey @ql", 7)).toEqual({
            type: "mention",
            query: "ql",
            start: 4,
            end: 7,
        });
        expect(getComposerTrigger("email@x.com", 11)).toBeNull();
    });

    it("filters slash commands by query", () => {
        expect(filterSlashCommands("sug").map((command) => command.id)).toContain("suggestion");
        expect(filterSlashCommands("").length).toBe(SLASH_COMMANDS.length);
    });

    it("applies a slash command by replacing the trigger token", () => {
        const trigger = getComposerTrigger("/code", 5);
        expect(trigger?.type).toBe("slash");
        if (trigger?.type !== "slash") {
            return;
        }
        const command = SLASH_COMMANDS.find((entry) => entry.id === "code")!;
        const next = applySlashCommand("/code", trigger, command);
        expect(next.value).toContain("```");
    });

    it("applies a mention and filters candidates", () => {
        const trigger = getComposerTrigger("@al", 3);
        expect(trigger?.type).toBe("mention");
        if (trigger?.type !== "mention") {
            return;
        }
        expect(applyMention("@al", trigger, "alice").value).toBe("@alice ");
        expect(
            filterMentionLogins(
                [
                    { login: "alice", avatarUrl: "https://example.com/a.png" },
                    { login: "bob", name: "Alice Bob" },
                    { login: "carol" },
                ],
                "ali",
            ),
        ).toEqual([
            { login: "alice", avatarUrl: "https://example.com/a.png" },
            { login: "bob", name: "Alice Bob" },
        ]);
    });

    it("seeds mention candidates from pull request participants", () => {
        expect(
            mentionCandidatesFromPullRequest({
                author: "alice",
                authorAvatarUrl: "https://example.com/a.png",
                reviewers: [{ login: "bob" }],
                assignees: ["carol", "alice"],
                reviewRequests: ["dave"],
            }).map((user) => user.login),
        ).toEqual(["alice", "bob", "carol", "dave"]);
    });
});
