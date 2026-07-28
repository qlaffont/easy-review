import { describe, expect, it } from "vitest";

import {
    collectUploadableMedia,
    collectUploadableMediaFromDataTransfer,
    dataTransferLooksLikeFiles,
    insertMediaPlaceholders,
    isUploadableMediaFile,
    mediaKindForFile,
    mediaMarkdown,
    removeMediaPlaceholder,
    replaceMediaPlaceholder,
    sanitizeMediaFileName,
    uploadingPlaceholder,
} from "#/lib/composer-media.ts";

function file(name: string, type: string, size = 100): File {
    const bytes = new Uint8Array(size);
    return new File([bytes], name, { type });
}

describe("composer media helpers", () => {
    it("accepts common image and video types within GitHub size limits", () => {
        expect(mediaKindForFile(file("shot.png", "image/png"))).toBe("image");
        expect(mediaKindForFile(file("clip.mp4", "video/mp4"))).toBe("video");
        expect(isUploadableMediaFile(file("shot.png", "image/png"))).toBe(true);
        expect(isUploadableMediaFile(file("huge.png", "image/png", 11 * 1024 * 1024))).toBe(false);
        expect(collectUploadableMedia([file("a.png", "image/png"), file("notes.txt", "text/plain")])).toHaveLength(1);
    });

    it("treats dragover types as a file drop even when files is still empty", () => {
        expect(dataTransferLooksLikeFiles({ types: ["Files"], files: [] } as unknown as DataTransfer)).toBe(true);
        expect(dataTransferLooksLikeFiles({ types: ["text/plain"], files: [] } as unknown as DataTransfer)).toBe(false);
    });

    it("collects clipboard paste files from items when files is empty", () => {
        const pasted = file("", "image/png");
        const media = collectUploadableMediaFromDataTransfer({
            files: [] as unknown as FileList,
            items: [{ kind: "file", getAsFile: () => pasted }],
            types: ["Files"],
        } as unknown as DataTransfer);

        expect(media).toHaveLength(1);
        expect(media[0]?.file.name).toBe("image.png");
        expect(media[0]?.kind).toBe("image");
    });

    it("builds GitHub-style markdown for images and bare urls for videos", () => {
        expect(mediaMarkdown("image", "shot.png", "https://example/shot.png")).toBe(
            "![shot.png](https://example/shot.png)",
        );
        expect(mediaMarkdown("video", "clip.mp4", "https://example/clip.mp4")).toBe(
            '<video src="https://example/clip.mp4" controls></video>',
        );
    });

    it("inserts and replaces uploading placeholders at the caret", () => {
        const token = "abc123";
        const { value, selectionEnd } = insertMediaPlaceholders("Before", 6, 6, [{ name: "shot.png", token }]);
        expect(value).toContain(uploadingPlaceholder("shot.png", token));
        expect(selectionEnd).toBeGreaterThan(6);

        const uploaded = replaceMediaPlaceholder(
            value,
            token,
            "shot.png",
            "![shot.png](https://github.com/acme/api/blob/sha/shot.png?raw=true)",
        );
        expect(uploaded).toContain("![shot.png](https://github.com/acme/api/blob/sha/shot.png?raw=true)");
        expect(uploaded).not.toContain("uploading://");

        expect(removeMediaPlaceholder(value, token, "shot.png")).toBe("Before");
    });

    it("sanitizes file names for git paths", () => {
        expect(sanitizeMediaFileName("My Shot (1).PNG")).toBe("My_Shot_(1).PNG");
        expect(sanitizeMediaFileName("../../etc/passwd")).toBe("passwd");
    });
});
