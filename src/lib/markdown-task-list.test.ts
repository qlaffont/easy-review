import { describe, expect, it } from "vitest";

import { toggleMarkdownTask } from "#/lib/markdown-task-list.ts";

describe("toggleMarkdownTask", () => {
    it("checks the requested task list item", () => {
        const source = ["- [ ] first", "- [ ] second"].join("\n");
        expect(toggleMarkdownTask(source, 1, true)).toBe("- [ ] first\n- [x] second");
    });

    it("unchecks a completed item", () => {
        expect(toggleMarkdownTask("- [x] done", 0, false)).toBe("- [ ] done");
    });

    it("ignores task markers inside fenced code", () => {
        const source = ["```", "- [ ] example", "```", "- [ ] real"].join("\n");
        expect(toggleMarkdownTask(source, 0, true)).toBe("```\n- [ ] example\n```\n- [x] real");
    });

    it("handles nested and numbered lists", () => {
        const source = ["1. [ ] alpha", "   - [ ] nested"].join("\n");
        expect(toggleMarkdownTask(source, 1, true)).toBe("1. [ ] alpha\n   - [x] nested");
    });

    it("returns null when the index is missing", () => {
        expect(toggleMarkdownTask("- [ ] only", 4, true)).toBeNull();
    });
});
