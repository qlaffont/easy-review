import { useEffect } from "react";

import { env } from "#/env.ts";

/** Default blurb when a route does not supply its own description. */
export const DEFAULT_DESCRIPTION =
    "Easy Review is a fast GitHub pull-request inbox and review workspace for triage, diffs, and staged reviews.";

/** Square brand image used for Slack/Discord unfurls and social cards. */
export const OG_IMAGE_PATH = "/og-image.png";

export function siteName(): string {
    return env.VITE_APP_TITLE?.trim() || "Easy Review";
}

/** Public site origin for absolute OG/asset URLs (Slack prefers absolute `og:image`). */
export function siteOrigin(): string | null {
    // Read Vite public env directly — never touch `env.SERVER_*` from this client-shared module.
    const configured = import.meta.env.VITE_APP_URL;
    if (typeof configured === "string" && configured.length > 0) {
        try {
            return new URL(configured).origin;
        } catch {
            return null;
        }
    }

    if (typeof window !== "undefined" && window.location?.origin) {
        return window.location.origin;
    }

    return null;
}

export function absoluteUrl(path: string): string | null {
    const origin = siteOrigin();
    if (!origin) {
        return null;
    }
    return new URL(path, origin).toString();
}

/** `Inbox` → `Inbox · Easy Review`; bare site name stays un-suffixed. */
export function formatTitle(pageTitle: string): string {
    const site = siteName();
    const trimmed = pageTitle.trim();
    if (!trimmed || trimmed === site) {
        return site;
    }
    return `${trimmed} · ${site}`;
}

export type PageSeoInput = {
    /** Page-specific title (without the site suffix). */
    title: string;
    description?: string;
    /** Absolute path for og:url when the browser origin is known. */
    path?: string;
    /** Defaults to noindex — the app is auth-gated. */
    robots?: string;
};

type HeadMeta =
    | { title: string }
    | { charSet: string }
    | { name: string; content: string }
    | { property: string; content: string };

export type PageHead = {
    meta: Array<HeadMeta>;
};

/** Build TanStack Router `head()` meta for a page (title, description, OG, Twitter). */
export function buildHead(input: PageSeoInput): PageHead {
    const title = formatTitle(input.title);
    const description = (input.description ?? DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION;
    const robots = input.robots ?? "noindex, nofollow";
    const imageUrl = absoluteUrl(OG_IMAGE_PATH) ?? OG_IMAGE_PATH;
    const pageUrl = input.path ? absoluteUrl(input.path) : null;

    const meta: Array<HeadMeta> = [
        { title },
        { name: "description", content: description },
        { name: "robots", content: robots },
        { name: "application-name", content: siteName() },
        { name: "theme-color", content: "#ffffff" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: siteName() },
        { property: "og:image", content: imageUrl },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "512" },
        { property: "og:image:height", content: "512" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: imageUrl },
    ];

    if (pageUrl) {
        meta.push({ property: "og:url", content: pageUrl });
    } else if (input.path && typeof window !== "undefined" && window.location?.origin) {
        meta.push({ property: "og:url", content: new URL(input.path, window.location.origin).toString() });
    }

    return { meta };
}

/** Automatic PR page SEO input from route params, optionally enriched with the live title. */
export function pullRequestSeo(input: {
    owner: string;
    repo: string;
    number: string | number;
    title?: string | null;
}): PageSeoInput {
    const number = String(input.number);
    const repo = `${input.owner}/${input.repo}`;
    const prTitle = input.title?.trim() ?? "";

    return {
        title: prTitle ? `${prTitle} · ${repo}#${number}` : `${repo}#${number}`,
        description: prTitle
            ? `Review pull request #${number} “${prTitle}” in ${repo} with Easy Review.`
            : `Review pull request #${number} in ${repo} with Easy Review.`,
        path: `/pr/${input.owner}/${input.repo}/${number}`,
    };
}

/** Route `head()` helper for pull request pages. */
export function pullRequestHead(input: {
    owner: string;
    repo: string;
    number: string | number;
    title?: string | null;
}): PageHead {
    return buildHead(pullRequestSeo(input));
}

function upsertMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
    if (typeof document === "undefined") {
        return;
    }

    let element = document.head.querySelector<HTMLMetaElement>(selector);
    if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
    }
    element.setAttribute("content", content);
}

/**
 * Keep the document head in sync after client data loads (e.g. PR title arrives).
 * Route `head()` covers the first paint; this upgrades title/description afterward.
 */
export function usePageSeo(input: PageSeoInput): void {
    const title = formatTitle(input.title);
    const description = (input.description ?? DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION;

    useEffect(() => {
        document.title = title;
        upsertMeta('meta[name="description"]', "name", "description", description);
        upsertMeta('meta[property="og:title"]', "property", "og:title", title);
        upsertMeta('meta[property="og:description"]', "property", "og:description", description);
        upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
        upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description);

        if (input.path && window.location?.origin) {
            upsertMeta(
                'meta[property="og:url"]',
                "property",
                "og:url",
                new URL(input.path, window.location.origin).toString(),
            );
        }

        const imageUrl = absoluteUrl(OG_IMAGE_PATH) ?? OG_IMAGE_PATH;
        upsertMeta('meta[property="og:image"]', "property", "og:image", imageUrl);
        upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", imageUrl);
    }, [title, description, input.path]);
}
