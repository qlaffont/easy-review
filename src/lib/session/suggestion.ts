const SUGGESTION_FENCE = /```suggestion\n[\s\S]*?\n```/;

/** Build a review comment body with a GitHub apply-able suggestion fence. */
export function buildSuggestionComment(comment: string, suggestedCode: string): string {
    const code = (suggestedCode ?? "").replace(/\n$/, "");
    const fence = ["```suggestion", code, "```"].join("\n");
    const trimmed = (comment ?? "").trim();
    return trimmed ? `${trimmed}\n\n${fence}` : fence;
}

export function hasSuggestionFence(body: string): boolean {
    return SUGGESTION_FENCE.test(body);
}

/** Remove the first suggestion fence from a comment body. */
export function stripSuggestionFence(body: string): string {
    return body
        .replace(SUGGESTION_FENCE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
