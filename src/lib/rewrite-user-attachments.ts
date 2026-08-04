/**
 * Replace private `user-attachments` markdown URLs with short-lived signed CDN URLs
 * taken from GitHub’s `bodyHTML` (same approach as VS Code’s PR extension).
 *
 * Markdown keeps `https://github.com/user-attachments/assets/{uuid}`; `bodyHTML` embeds
 * `https://private-user-images.githubusercontent.com/...{uuid}...?jwt=...`. Matching is by UUID.
 */

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

const MARKDOWN_ATTACHMENT = new RegExp(
    `https://(?:www\\.)?github\\.com/(?:user-attachments|[^/]+/[^/]+)/assets/(?:[^/]+/)?(${UUID})`,
    "gi",
);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find a signed CDN (or GHE) URL in HTML that contains the attachment UUID. */
function signedUrlForUuid(htmlBody: string, uuid: string): string | null {
    const htmlExpression = new RegExp(
        `https://([^"'\\s]*githubusercontent\\.com|[^"'\\s]*amazonaws\\.com)[^"'\\s]*${escapeRegExp(uuid)}[^"'\\s]*`,
        "i",
    );
    return htmlBody.match(htmlExpression)?.[0] ?? null;
}

/**
 * Rewrite `user-attachments` URLs in markdown using signed URLs from `bodyHTML`.
 * Returns the original markdown when HTML is empty or no matches are found.
 */
export function rewriteUserAttachmentsFromHtml(markdownBody: string, htmlBody: string | null | undefined): string {
    if (!htmlBody?.trim()) {
        return markdownBody;
    }
    if (!markdownBody.includes("user-attachments") && !markdownBody.includes("/assets/")) {
        return markdownBody;
    }

    return markdownBody.replace(MARKDOWN_ATTACHMENT, (match, uuid: string) => {
        return signedUrlForUuid(htmlBody, uuid) ?? match;
    });
}
