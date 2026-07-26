/** Build a review comment body with a GitHub apply-able suggestion fence. */
export function buildSuggestionComment(comment: string, suggestedCode: string): string {
    const code = (suggestedCode ?? "").replace(/\n$/, "");
    const fence = ["```suggestion", code, "```"].join("\n");
    const trimmed = (comment ?? "").trim();
    return trimmed ? `${trimmed}\n\n${fence}` : fence;
}
