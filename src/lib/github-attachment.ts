/** GitHub upload CDN — images and videos share this host/path with no file extension. */
const USER_ATTACHMENT_PATH = /^\/user-attachments\/assets\/[0-9a-f-]+\/?$/i;

/** Graphite upload CDN — separate host from GitHub (`app.graphite.com/user-attachments/...`). */
const GRAPHITE_HOST = /^(?:[\w-]+\.)*graphite\.(?:com|dev)$/i;
const GRAPHITE_ATTACHMENT_PATH = /^\/user-attachments\/(video|image|images)\/(.+)$/i;

/** Easy Review PR media: `…/blob/<sha>/<path>?raw=true` (often private — needs auth to render). */
const REPO_BLOB_RAW_PATH = /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{7,40})\/(.+)$/i;

const VIDEO_PATH_EXTENSION = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** Video/image extensions in link labels (Graphite: `clip.mov (uploaded via Graphite)`). */
const VIDEO_IN_LINK_LABEL = /\.(mp4|webm|mov|m4v|ogv)(?:\s|\)|$)/i;
const IMAGE_IN_LINK_LABEL = /\.(png|jpe?g|gif|webp|svg)(?:\s|\)|$)/i;

export type ResolvedGithubAttachment = {
    kind: "image" | "video";
    src: string;
    name?: string;
};

export type GithubRepoBlobRawRef = {
    repository: string;
    sha: string;
    path: string;
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

export function isGraphiteUserAttachmentUrl(src: string | undefined): boolean {
    return parseGraphiteUserAttachmentUrl(src) != null;
}

/**
 * Parse Easy Review–uploaded (or similar) repo blob raw URLs.
 * Decodes `%2E` so older markdown with encodePath-style URLs still resolve.
 */
export function parseGithubRepoBlobRawUrl(src: string | undefined): GithubRepoBlobRawRef | null {
    if (!src) {
        return null;
    }

    try {
        const url = new URL(src, "https://github.com");
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return null;
        }
        const host = url.hostname.toLowerCase();
        if (host !== "github.com" && host !== "www.github.com") {
            return null;
        }
        if (url.searchParams.get("raw") !== "true") {
            return null;
        }
        const match = REPO_BLOB_RAW_PATH.exec(url.pathname);
        if (!match) {
            return null;
        }
        const path = decodeURIComponent(match[4]!);
        if (!path || path.split("/").includes("..")) {
            return null;
        }
        return {
            repository: `${match[1]}/${match[2]}`,
            sha: match[3]!,
            path,
        };
    } catch {
        return null;
    }
}

export function isGithubRepoBlobRawUrl(src: string | undefined): boolean {
    return parseGithubRepoBlobRawUrl(src) !== null;
}

export function mediaKindFromPath(path: string): "image" | "video" {
    return VIDEO_PATH_EXTENSION.test(path) ? "video" : "image";
}

/** Guess media kind from Graphite-style or filename link text before GitHub resolves the asset. */
export function mediaKindFromLinkText(text: string): "image" | "video" | null {
    const trimmed = text.trim();
    if (VIDEO_IN_LINK_LABEL.test(trimmed) || VIDEO_PATH_EXTENSION.test(trimmed)) {
        return "video";
    }
    if (IMAGE_IN_LINK_LABEL.test(trimmed)) {
        return "image";
    }
    return null;
}

/** Strip Graphite upload metadata from visible link labels. */
export function attachmentLabelFromLinkText(text: string): string {
    return text
        .replace(/\s*\(uploaded via Graphite\)\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Parse Graphite `user-attachments` video/image URLs from PR descriptions. */
export function parseGraphiteUserAttachmentUrl(src: string | undefined): ResolvedGithubAttachment | null {
    if (!src) {
        return null;
    }

    try {
        const url = new URL(src);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return null;
        }
        if (!GRAPHITE_HOST.test(url.hostname.toLowerCase())) {
            return null;
        }

        const match = GRAPHITE_ATTACHMENT_PATH.exec(url.pathname);
        if (!match) {
            return null;
        }

        const section = match[1]!.toLowerCase();
        const filename = decodeURIComponent(match[2]!);
        const kind =
            section === "video" || (section !== "image" && section !== "images" && VIDEO_PATH_EXTENSION.test(filename))
                ? "video"
                : VIDEO_PATH_EXTENSION.test(filename)
                  ? "video"
                  : "image";

        return {
            kind,
            src: url.href,
            ...(filename ? { name: filename } : {}),
        };
    } catch {
        return null;
    }
}

export function shouldEmbedGraphiteAttachment(href: string | undefined): boolean {
    return parseGraphiteUserAttachmentUrl(href) != null;
}

export function isGithubPrivateMediaUrl(src: string | undefined): boolean {
    return isGithubUserAttachmentUrl(src) || isGithubRepoBlobRawUrl(src);
}

/**
 * GitHub auto-embeds bare `user-attachments` URLs (autolinks). Named links with a media
 * filename or Graphite’s “(uploaded via Graphite)” label are embedded too.
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
        if (text === `${url.host}${url.pathname}`.replace(/\/$/, "") || text === url.href.replace(/\/$/, "")) {
            return true;
        }
    } catch {
        /* fall through */
    }

    if (/\(uploaded via Graphite\)/i.test(text)) {
        return true;
    }

    if (VIDEO_IN_LINK_LABEL.test(text) || IMAGE_IN_LINK_LABEL.test(text)) {
        return true;
    }

    return false;
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
