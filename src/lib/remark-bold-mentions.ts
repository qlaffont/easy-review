import type { PhrasingContent, Root, Text } from "mdast";

import { visit } from "unist-util-visit";

/**
 * GitHub login after `@`: 1–39 chars, alphanumerics/hyphens, no leading/trailing hyphen.
 * Negative lookbehind avoids matching the domain side of emails (`user@host.com`).
 */
const MENTION_RE = /(?<![\w])@[a-zA-Z\d](?:[a-zA-Z\d-]{0,37}[a-zA-Z\d])?\b/g;

/** Wrap bare `@login` mentions in `strong` so they read like GitHub (bold). */
export function remarkBoldMentions() {
    return (tree: Root) => {
        visit(tree, "text", (node: Text, index, parent) => {
            if (parent == null || index == null) {
                return;
            }

            // Skip when already emphasized or inside a link (linked mentions stay as-is;
            // the markdown `a` renderer bolds GitHub profile URLs separately).
            if (parent.type === "link" || parent.type === "linkReference" || parent.type === "strong") {
                return;
            }

            const { value } = node;
            MENTION_RE.lastIndex = 0;
            if (!MENTION_RE.test(value)) {
                return;
            }

            const next: Array<PhrasingContent> = [];
            let last = 0;
            MENTION_RE.lastIndex = 0;
            for (const match of value.matchAll(MENTION_RE)) {
                const start = match.index ?? 0;
                if (start > last) {
                    next.push({ type: "text", value: value.slice(last, start) });
                }
                next.push({
                    type: "strong",
                    children: [{ type: "text", value: match[0]! }],
                });
                last = start + match[0]!.length;
            }
            if (last < value.length) {
                next.push({ type: "text", value: value.slice(last) });
            }

            parent.children.splice(index, 1, ...next);
            return index + next.length;
        });
    };
}
