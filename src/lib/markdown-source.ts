/** Strip HTML comments GitHub hides (bot metadata, tips markers, etc.). */
export function prepareMarkdownSource(source: string): string {
    return source.replace(/<!--([\s\S]*?)-->/g, "").replace(/\n{3,}/g, "\n\n");
}
