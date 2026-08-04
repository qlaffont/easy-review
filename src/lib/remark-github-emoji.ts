import type { Root } from "mdast";

import { nameToEmoji } from "gemoji";
import { findAndReplace } from "mdast-util-find-and-replace";

/**
 * Slack / Unicode CLDR short names authors type that map onto gemoji’s GitHub names.
 * `:thinking_face:` → 🤔 (`:thinking:` on GitHub).
 */
const EMOJI_ALIASES: Record<string, string> = {
    thinking_face: "thinking",
};

/** Turn gemoji shortcodes (`:+1:`, `:thinking_face:`) into emoji characters. */
export function remarkGithubEmoji() {
    return (tree: Root) => {
        findAndReplace(tree, [
            /:(\+1|[-\w]+):/g,
            (_: string, name: string) => {
                const key = EMOJI_ALIASES[name] ?? name;
                return Object.hasOwn(nameToEmoji, key) ? nameToEmoji[key]! : false;
            },
        ]);
    };
}
