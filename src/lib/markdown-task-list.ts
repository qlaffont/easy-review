const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/;
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;

/**
 * Flip the `index`-th GitHub task-list checkbox in markdown source.
 * Skips fenced code so example `- [ ]` blocks are not counted.
 * Returns null when that index does not exist.
 */
export function toggleMarkdownTask(source: string, index: number, checked: boolean): string | null {
    const lines = source.split("\n");
    let fenceMarker: string | null = null;
    let current = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!;
        const fence = FENCE_LINE.exec(line);
        if (fence) {
            const marker = fence[1]![0]!;
            if (fenceMarker === null) {
                fenceMarker = marker;
            } else if (fenceMarker === marker) {
                fenceMarker = null;
            }
            continue;
        }
        if (fenceMarker !== null) {
            continue;
        }

        const match = TASK_LINE.exec(line);
        if (!match) {
            continue;
        }
        if (current === index) {
            const mark = checked ? "x" : " ";
            lines[lineIndex] = `${match[1]}[${mark}]${line.slice(match[0].length)}`;
            return lines.join("\n");
        }
        current += 1;
    }

    return null;
}
