/** GitHub upload CDN — images and videos share this host/path with no file extension. */
const USER_ATTACHMENT_PATH = /^\/user-attachments\/assets\/[0-9a-f-]+\/?$/i;

export type ResolvedGithubAttachment = {
    kind: "image" | "video";
    src: string;
    name?: string;
};

export function isGithubUserAttachmentUrl(src: string | undefined): boolean {
    if (!src) {
        return false;
    }

    try {
        const url = new URL(src, "https://github.com");
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return false;
        }
        const host = url.hostname.toLowerCase();
        if (host !== "github.com" && host !== "www.github.com") {
            return false;
        }
        return USER_ATTACHMENT_PATH.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * GitHub auto-embeds bare `user-attachments` URLs (autolinks). Named links stay links.
 * Link text may be the full URL or the same URL without a scheme (GFM).
 */
export function shouldEmbedGithubAttachment(href: string | undefined, linkText: string): boolean {
    if (!isGithubUserAttachmentUrl(href) || !href) {
        return false;
    }

    const text = linkText.trim();
    if (!text) {
        return false;
    }

    if (text === href) {
        return true;
    }

    try {
        const url = new URL(href);
        return text === `${url.host}${url.pathname}`.replace(/\/$/, "") || text === url.href.replace(/\/$/, "");
    } catch {
        return false;
    }
}

/** `https://github.com/{owner}/{repo}/…` → `owner/repo`. */
export function repositoryFromGithubBaseUrl(baseUrl: string): string | null {
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        if (host !== "github.com" && host !== "www.github.com") {
            return null;
        }
        const [owner, repo] = url.pathname.split("/").filter(Boolean);
        if (!owner || !repo) {
            return null;
        }
        return `${owner}/${repo}`;
    } catch {
        return null;
    }
}

/** Signed media URLs GitHub’s markdown API embeds for user-attachments. */
export function isAllowedResolvedAttachmentSrc(src: string): boolean {
    try {
        const url = new URL(src);
        if (url.protocol !== "https:") {
            return false;
        }
        const host = url.hostname.toLowerCase();
        return (
            host === "github.com" ||
            host === "www.github.com" ||
            host.endsWith(".githubusercontent.com") ||
            host.endsWith(".amazonaws.com")
        );
    } catch {
        return false;
    }
}

/**
 * Parse HTML from `POST /markdown` (GFM + repo context). GitHub rewrites bare
 * `user-attachments` URLs into `<video>` / `<img>` pointing at short-lived signed CDN URLs.
 */
export function parseGithubAttachmentMarkdownHtml(html: string): ResolvedGithubAttachment | null {
    const videoSrc = html.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    if (videoSrc && isAllowedResolvedAttachmentSrc(videoSrc)) {
        const name = html.match(/<span\b[^>]*class=["'][^"']*m-1[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1]?.trim();
        return { kind: "video", src: videoSrc, ...(name ? { name } : {}) };
    }

    const imgSrc = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    if (imgSrc && isAllowedResolvedAttachmentSrc(imgSrc)) {
        return { kind: "image", src: imgSrc };
    }

    return null;
}
