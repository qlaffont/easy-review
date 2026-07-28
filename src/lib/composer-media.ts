import type { MarkdownEditResult } from "#/lib/markdown-edit.ts";

import { insertBlock } from "#/lib/markdown-edit.ts";

/** GitHub web UI limits (images 10 MB, videos 100 MB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

export type MediaKind = "image" | "video";

export type UploadableMedia = {
    file: File;
    kind: MediaKind;
};

function extensionOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function mediaKindForNameAndType(name: string, type: string): MediaKind | null {
    if (IMAGE_TYPES.has(type) || IMAGE_EXTENSIONS.has(extensionOf(name))) {
        return "image";
    }
    if (VIDEO_TYPES.has(type) || VIDEO_EXTENSIONS.has(extensionOf(name))) {
        return "video";
    }
    return null;
}

export function mediaKindForFile(file: File): MediaKind | null {
    return mediaKindForNameAndType(file.name, file.type);
}

export function isUploadableMediaFile(file: File): boolean {
    const kind = mediaKindForFile(file);
    if (!kind) {
        return false;
    }
    const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    return file.size > 0 && file.size <= max;
}

/** Collect paste/drop files that GitHub would accept as media attachments. */
export function collectUploadableMedia(files: Iterable<File>): Array<UploadableMedia> {
    const out: Array<UploadableMedia> = [];
    for (const file of files) {
        const kind = mediaKindForFile(file);
        if (!kind || !isUploadableMediaFile(file)) {
            continue;
        }
        out.push({ file, kind });
    }
    return out;
}

export function collectUploadableMediaFromDataTransfer(data: DataTransfer | null): Array<UploadableMedia> {
    if (!data?.files?.length) {
        return [];
    }
    return collectUploadableMedia(Array.from(data.files));
}

/** Safe path segment for the hidden upload ref tree. */
export function sanitizeMediaFileName(name: string): string {
    const leaf = name.trim().split(/[/\\]/).pop() ?? "upload";
    const base = leaf.replace(/[^\w.\-()+]+/g, "_").replace(/^\.+/, "");
    return (base || "upload").slice(0, 180);
}

export function mediaMarkdown(kind: MediaKind, name: string, url: string): string {
    if (kind === "image") {
        return `![${name.replaceAll(/[[\]]/g, "")}](${url})`;
    }
    // HTML video — bare blob URLs are not auto-embedded the way user-attachments are.
    return `<video src="${url}" controls></video>`;
}

export function uploadingPlaceholder(name: string, token: string): string {
    return `![Uploading ${name}…](uploading://${token})`;
}

export function insertMediaPlaceholders(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    items: ReadonlyArray<{ name: string; token: string }>,
): MarkdownEditResult {
    if (items.length === 0) {
        return { value, selectionStart, selectionEnd };
    }

    const block = items.map((item) => uploadingPlaceholder(item.name, item.token)).join("\n");
    return insertBlock(value, selectionStart, selectionEnd, block);
}

export function replaceMediaPlaceholder(value: string, token: string, name: string, replacement: string): string {
    const needle = uploadingPlaceholder(name, token);
    return value.includes(needle) ? value.replace(needle, replacement) : `${value.trimEnd()}\n\n${replacement}\n`;
}

export function removeMediaPlaceholder(value: string, token: string, name: string): string {
    const needle = uploadingPlaceholder(name, token);
    return value
        .replace(needle, "")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
}
