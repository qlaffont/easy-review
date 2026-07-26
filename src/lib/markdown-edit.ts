/** Result of applying a markdown toolbar action to a textarea value. */
export type MarkdownEditResult = {
    value: string;
    selectionStart: number;
    selectionEnd: number;
};

/**
 * Wrap the current selection (or a placeholder) with markdown delimiters.
 * If the selection is already wrapped, unwrap it.
 */
export function wrapSelection(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    before: string,
    after: string,
    placeholder = "text",
): MarkdownEditResult {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(start, Math.min(selectionEnd, value.length));
    const selected = value.slice(start, end);

    if (
        selected.length > 0 &&
        start >= before.length &&
        end + after.length <= value.length &&
        value.slice(start - before.length, start) === before &&
        value.slice(end, end + after.length) === after
    ) {
        return {
            value: value.slice(0, start - before.length) + selected + value.slice(end + after.length),
            selectionStart: start - before.length,
            selectionEnd: end - before.length,
        };
    }

    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
        const inner = selected.slice(before.length, selected.length - after.length);
        return {
            value: value.slice(0, start) + inner + value.slice(end),
            selectionStart: start,
            selectionEnd: start + inner.length,
        };
    }

    const inner = selected.length > 0 ? selected : placeholder;
    const next = value.slice(0, start) + before + inner + after + value.slice(end);
    const innerStart = start + before.length;

    return {
        value: next,
        selectionStart: innerStart,
        selectionEnd: innerStart + inner.length,
    };
}

/** Prefix every line in the selection (or the current line) with `prefix`. */
export function prefixLines(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    prefix: string,
): MarkdownEditResult {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(start, Math.min(selectionEnd, value.length));

    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) {
        lineEnd = value.length;
    }

    const block = value.slice(lineStart, lineEnd);
    const lines = block.length === 0 ? [""] : block.split("\n");
    const nextBlock = lines
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`))
        .join("\n");

    return {
        value: value.slice(0, lineStart) + nextBlock + value.slice(lineEnd),
        selectionStart: lineStart,
        selectionEnd: lineStart + nextBlock.length,
    };
}

/** Insert a block at the caret, ensuring surrounding newlines. */
export function insertBlock(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    block: string,
): MarkdownEditResult {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(start, Math.min(selectionEnd, value.length));
    const before = value.slice(0, start);
    const after = value.slice(end);

    const needsLeading = before.length > 0 && !before.endsWith("\n");
    const needsTrailing = after.length > 0 && !after.startsWith("\n");
    const inserted = `${needsLeading ? "\n" : ""}${block}${needsTrailing ? "\n" : ""}`;
    const caret = before.length + (needsLeading ? 1 : 0) + block.length;

    return {
        value: before + inserted + after,
        selectionStart: caret,
        selectionEnd: caret,
    };
}

export function insertLink(value: string, selectionStart: number, selectionEnd: number): MarkdownEditResult {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(start, Math.min(selectionEnd, value.length));
    const selected = value.slice(start, end);
    const label = selected.length > 0 ? selected : "link text";
    const next = value.slice(0, start) + `[${label}](url)` + value.slice(end);
    const urlStart = start + label.length + 3;

    return {
        value: next,
        selectionStart: urlStart,
        selectionEnd: urlStart + 3,
    };
}
