import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "#/components/pr/markdown.tsx";
import {
    attachmentLabelFromLinkText,
    isGithubPrivateMediaUrl,
    isGithubRepoBlobRawUrl,
    isGithubUserAttachmentUrl,
    isGraphiteUserAttachmentUrl,
    mediaKindFromLinkText,
    parseGithubAttachmentMarkdownHtml,
    parseGithubRepoBlobRawUrl,
    parseGraphiteUserAttachmentUrl,
    repositoryFromGithubBaseUrl,
    shouldEmbedGithubAttachment,
    shouldEmbedGraphiteAttachment,
} from "#/lib/github-attachment.ts";

const ATTACHMENT = "https://github.com/user-attachments/assets/0682c898-4e3a-4209-a711-54519406d6a8";
const GRAPHITE_VIDEO = "https://app.graphite.com/user-attachments/video/4280fb23-bfcc-429d-95a4-461f52ce5fc1.mov";
const REPO_BLOB =
    "https://github.com/acme/api/blob/b395d09f1dd536188676eeb4a6958f77aebf3f08/ae48774b65c9-shot.png?raw=true";
const REPO_BLOB_ENCODED =
    "https://github.com/acme/api/blob/b395d09f1dd536188676eeb4a6958f77aebf3f08/ae48774b65c9-shot%2Epng?raw=true";

function renderMarkdown(source: string): string {
    return renderToStaticMarkup(createElement(Markdown, { source, baseUrl: "https://github.com/acme/api" }));
}

describe("isGithubUserAttachmentUrl", () => {
    it("accepts github user-attachments asset urls", () => {
        expect(isGithubUserAttachmentUrl(ATTACHMENT)).toBe(true);
        expect(isGithubUserAttachmentUrl(`${ATTACHMENT}/`)).toBe(true);
    });

    it("rejects other hosts and paths", () => {
        expect(isGithubUserAttachmentUrl("https://app.intercom.com/a/inbox/x")).toBe(false);
        expect(isGithubUserAttachmentUrl("https://github.com/acme/api/assets/1")).toBe(false);
        expect(isGithubUserAttachmentUrl("https://user-images.githubusercontent.com/1/x.png")).toBe(false);
        expect(isGithubUserAttachmentUrl(GRAPHITE_VIDEO)).toBe(false);
    });
});

describe("parseGraphiteUserAttachmentUrl", () => {
    it("parses Graphite video urls", () => {
        expect(parseGraphiteUserAttachmentUrl(GRAPHITE_VIDEO)).toEqual({
            kind: "video",
            src: GRAPHITE_VIDEO,
            name: "4280fb23-bfcc-429d-95a4-461f52ce5fc1.mov",
        });
        expect(isGraphiteUserAttachmentUrl(GRAPHITE_VIDEO)).toBe(true);
        expect(shouldEmbedGraphiteAttachment(GRAPHITE_VIDEO)).toBe(true);
    });

    it("rejects Graphite thumbnail paths", () => {
        expect(
            parseGraphiteUserAttachmentUrl(
                "https://app.graphite.com/user-attachments/thumbnails/4280fb23-bfcc-429d-95a4-461f52ce5fc1.mov",
            ),
        ).toBeNull();
    });
});

describe("parseGithubRepoBlobRawUrl", () => {
    it("parses easy-review upload blob raw urls", () => {
        expect(parseGithubRepoBlobRawUrl(REPO_BLOB)).toEqual({
            repository: "acme/api",
            sha: "b395d09f1dd536188676eeb4a6958f77aebf3f08",
            path: "ae48774b65c9-shot.png",
        });
        expect(isGithubRepoBlobRawUrl(REPO_BLOB)).toBe(true);
        expect(isGithubPrivateMediaUrl(REPO_BLOB)).toBe(true);
    });

    it("decodes legacy %2E upload urls", () => {
        expect(parseGithubRepoBlobRawUrl(REPO_BLOB_ENCODED)?.path).toBe("ae48774b65c9-shot.png");
    });

    it("rejects blob urls without raw=true", () => {
        expect(
            parseGithubRepoBlobRawUrl(
                "https://github.com/acme/api/blob/b395d09f1dd536188676eeb4a6958f77aebf3f08/shot.png",
            ),
        ).toBeNull();
    });
});

describe("shouldEmbedGithubAttachment", () => {
    it("embeds autolinks whose text is the attachment url", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, ATTACHMENT)).toBe(true);
    });

    it("keeps generic named links as ordinary links", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, "screenshot")).toBe(false);
        expect(shouldEmbedGithubAttachment(ATTACHMENT, "Open asset")).toBe(false);
    });

    it("embeds Graphite-style video links with a filename label", () => {
        const label = "Enregistrement de l'écran 2026-07-30 à 17.56.22.mov (uploaded via Graphite)";
        expect(shouldEmbedGithubAttachment(ATTACHMENT, label)).toBe(true);
        expect(mediaKindFromLinkText(label)).toBe("video");
    });

    it("embeds user-attachments links labeled with a screenshot filename", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, "Capture d'écran 2026-08-04 à 12.02.08.png")).toBe(true);
        expect(mediaKindFromLinkText("Capture d'écran 2026-08-04 à 12.02.08.png")).toBe("image");
    });

    it("embeds user-attachments links with no visible label (GitHub HTML thumbnail wrapper)", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, "")).toBe(true);
    });
});

describe("Markdown github attachment embeds", () => {
    it("renders a bare user-attachments url as media, not a plain link", () => {
        const html = renderMarkdown(`Fix concurrency:\n\n${ATTACHMENT}`);

        expect(html).toContain(`src="${ATTACHMENT}"`);
        expect(html).toMatch(/<(?:img|video)\b/);
        expect(html).not.toMatch(
            new RegExp(
                `<a[^>]*href="${ATTACHMENT.replaceAll("/", "\\/")}"[^>]*>\\s*${ATTACHMENT.replaceAll("/", "\\/")}`,
            ),
        );
    });

    it("still links ordinary urls", () => {
        const other = "https://app.intercom.com/a/inbox/j8ntmoix/conversation/1";
        const html = renderMarkdown(other);
        expect(html).toContain(`href="${other}"`);
        expect(html).toContain("<a ");
    });

    it("keeps an explicitly labeled non-media attachment link as a link", () => {
        const html = renderMarkdown(`[Open asset](${ATTACHMENT})`);
        expect(html).toContain(`href="${ATTACHMENT}"`);
        expect(html).toContain("Open asset");
        expect(html).not.toMatch(/<(?:img|video)\b/);
    });

    it("renders Graphite video links as an embedded player", () => {
        const label = "screen-recording.mov (uploaded via Graphite)";
        const html = renderMarkdown(`[${label}](${ATTACHMENT})`);
        expect(html).toContain(`src="${ATTACHMENT}"`);
        expect(html).toMatch(/<video\b/);
        expect(html).not.toContain("screen-recording.mov (uploaded via Graphite)");
    });

    it("routes repo blob raw images through private media resolution", () => {
        const html = renderMarkdown(`![shot.png](${REPO_BLOB})`);
        expect(html).toContain(`src="${REPO_BLOB}"`);
        expect(html).toMatch(/<img\b/);
    });

    it("embeds GitHub HTML thumbnail links as full media, not a tiny inline preview", () => {
        const signed = "https://private-user-images.githubusercontent.com/1/abc.png?jwt=test";
        const html = renderMarkdown(
            `<a href="${ATTACHMENT}" target="_blank" rel="noopener noreferrer"><img src="${signed}" width="200" alt="Capture d'écran 2026-08-04 à 12.02.08.png"></a>`,
        );

        expect(html).toContain(`src="${ATTACHMENT}"`);
        expect(html).toMatch(/<img\b/);
        expect(html).not.toContain('width="200"');
        expect(html).not.toContain(`href="${ATTACHMENT}"`);
    });

    it("renders Graphite video links with HTML label as an embedded player", () => {
        const markdown = `[Enregistrement de l'écran 2026-07-30 à 17.56.22.mov <span class="graphite__hidden">(uploaded via Graphite)</span> <img class="graphite__hidden" src="https://app.graphite.com/user-attachments/thumbnails/4280fb23-bfcc-429d-95a4-461f52ce5fc1.mov" />](${GRAPHITE_VIDEO})`;
        const html = renderMarkdown(markdown);

        expect(html).toContain(`src="${GRAPHITE_VIDEO}"`);
        expect(html).toMatch(/<video\b/);
        expect(html).toMatch(/Enregistrement de l(?:'|&#x27;)écran 2026-07-30 à 17\.56\.22\.mov/);
        expect(html).not.toContain("(uploaded via Graphite)");
    });
});

describe("attachmentLabelFromLinkText", () => {
    it("strips Graphite upload metadata from link labels", () => {
        expect(
            attachmentLabelFromLinkText("Enregistrement de l'écran 2026-07-30 à 17.56.22.mov (uploaded via Graphite)"),
        ).toBe("Enregistrement de l'écran 2026-07-30 à 17.56.22.mov");
    });
});

describe("parseGithubAttachmentMarkdownHtml", () => {
    it("extracts signed video urls and filenames from GitHub markdown HTML", () => {
        const html = `<details open="" class="details-reset border rounded-2">
  <summary class="tmp-px-3 py-2">
    <span class="m-1">clip.mov</span>
  </summary>
  <video src="https://private-user-images.githubusercontent.com/1/x.mp4?jwt=abc" controls="controls"></video>
</details>`;
        expect(parseGithubAttachmentMarkdownHtml(html)).toEqual({
            kind: "video",
            src: "https://private-user-images.githubusercontent.com/1/x.mp4?jwt=abc",
            name: "clip.mov",
        });
    });

    it("extracts signed image urls", () => {
        const html = `<p><img src="https://private-user-images.githubusercontent.com/1/x.png?jwt=abc" alt=""></p>`;
        expect(parseGithubAttachmentMarkdownHtml(html)).toEqual({
            kind: "image",
            src: "https://private-user-images.githubusercontent.com/1/x.png?jwt=abc",
        });
    });

    it("rejects non-GitHub media hosts", () => {
        expect(parseGithubAttachmentMarkdownHtml(`<video src="https://evil.example/x.mp4"></video>`)).toBeNull();
    });
});

describe("repositoryFromGithubBaseUrl", () => {
    it("reads owner/repo from github base urls", () => {
        expect(repositoryFromGithubBaseUrl("https://github.com/acme/api")).toBe("acme/api");
        expect(repositoryFromGithubBaseUrl("https://github.com/acme/api/blob/main/README.md")).toBe("acme/api");
    });
});

describe("Markdown mermaid fences", () => {
    it("renders a mermaid fence as a diagram host instead of a plain code block", () => {
        const html = renderMarkdown("```mermaid\nsequenceDiagram\n    A->>B: hi\n```");
        expect(html).toMatch(/aria-label="(?:Loading|Rendering) diagram"/);
        expect(html).not.toContain("sequenceDiagram");
    });
});
