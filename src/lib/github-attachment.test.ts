import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "#/components/pr/markdown.tsx";
import {
    isGithubUserAttachmentUrl,
    parseGithubAttachmentMarkdownHtml,
    repositoryFromGithubBaseUrl,
    shouldEmbedGithubAttachment,
} from "#/lib/github-attachment.ts";

const ATTACHMENT = "https://github.com/user-attachments/assets/0682c898-4e3a-4209-a711-54519406d6a8";

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
    });
});

describe("shouldEmbedGithubAttachment", () => {
    it("embeds autolinks whose text is the attachment url", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, ATTACHMENT)).toBe(true);
    });

    it("keeps named links as ordinary links", () => {
        expect(shouldEmbedGithubAttachment(ATTACHMENT, "screenshot")).toBe(false);
    });
});

describe("Markdown github attachment embeds", () => {
    it("renders a bare user-attachments url as media, not a plain link", () => {
        const html = renderMarkdown(`fix concurrency:\n\n${ATTACHMENT}`);

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

    it("keeps an explicitly labeled attachment link as a link", () => {
        const html = renderMarkdown(`[Open asset](${ATTACHMENT})`);
        expect(html).toContain(`href="${ATTACHMENT}"`);
        expect(html).toContain("Open asset");
        expect(html).not.toMatch(/<(?:img|video)\b/);
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
