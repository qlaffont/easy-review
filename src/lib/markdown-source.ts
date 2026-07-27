/**
 * Strip HTML comments GitHub hides (bot metadata, tips markers, etc.), and normalize
 * fenced code so CommonMark/micromark agree with how authors write on GitHub.
 */
export function prepareMarkdownSource(source: string): string {
    return ensureFencesOnOwnLine(
        stripEmptyHtmlNoise(source.replace(/<!--([\s\S]*?)-->/g, "")).replace(/\n{3,}/g, "\n\n"),
    );
}

/** Bots leave empty `<p>` / `<br>` stacks that become huge prose gaps. */
function stripEmptyHtmlNoise(source: string): string {
    return source
        .replace(/<p>(?:\s|&nbsp;|&#160;|<br\s*\/?\s*>)*<\/p>/gi, "")
        .replace(/<div>(?:\s|&nbsp;|&#160;|<br\s*\/?\s*>)*<\/div>/gi, "")
        .replace(/(?:<br\s*\/?\s*>\s*){2,}/gi, "<br>\n");
}

/**
 * Authors often write `Label: ```\\ncode` on one line. Micromark then keeps the body in a
 * paragraph (newlines collapse in HTML) and treats the closing fence as an empty code block.
 * Put the opening fence on its own line so the body becomes a real `<pre><code>`.
 *
 * Must not touch fences that only have blockquote markers before them (`> ```diff`), or the
 * fence leaves the quote while body lines keep their `> ` — which then shows up as `> +` in diffs.
 */
function ensureFencesOnOwnLine(source: string): string {
    return source.replace(/^([^\n`]*?)(```[^\n`]*)\r?\n/gm, (full, before: string, fence: string) => {
        const quotePrefix = /^(?:[ \t]*>[ \t]*)*/.exec(before)?.[0] ?? "";
        const prose = before.slice(quotePrefix.length).replace(/[ \t]+$/, "");
        if (!prose) {
            return full;
        }

        return `${quotePrefix}${prose}\n${quotePrefix}${fence}\n`;
    });
}
